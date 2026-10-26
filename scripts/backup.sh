#!/usr/bin/env bash
# Backup diário do banco do CRM (GAB-30, design §5) — chamado pelo cron do host
# (deploy/crontab.example), pelo deploy.sh antes das migrations e pelo restore.sh.
#
#   scripts/backup.sh
#
# Gera $BACKUP_DIR/ijcrm-<UTC>.dump (pg_dump formato custom, comprimido -Z 6),
# validado com `pg_restore --list` antes de ganhar o nome final.
# Retenção: apaga dumps com mais de $RETENCAO_DIAS dias (padrão 14) e qualquer
# `.parcial` que tenha sobrado de uma execução interrompida.
#
# Off-site: com BACKUP_REMOTE=<remote rclone>:<caminho> (ex.: b2:ij-crm-backups),
# copia o dump com `rclone copy` e aplica a mesma retenção lá. Sem ela, só avisa
# no log — cópia off-site é bloqueio de go-live (docs/runbook.md, checklist).
#
# O banco da Evolution NÃO entra: ele guarda a sessão do WhatsApp (Baileys) e
# depois de um desastre o caminho é parear de novo pelo QR (runbook §3).
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

RETENCAO_DIAS="${RETENCAO_DIAS:-14}"
# Do ambiente ou do .env (o cron do host não exporta nada).
carregar_ambiente
BACKUP_REMOTE="${BACKUP_REMOTE:-$(ler_env BACKUP_REMOTE)}"

[[ "$RETENCAO_DIAS" =~ ^[1-9][0-9]*$ ]] || falhar "RETENCAO_DIAS inválido: $RETENCAO_DIAS"
if [[ -n "$BACKUP_REMOTE" ]] && ! command -v rclone >/dev/null; then
  falhar "BACKUP_REMOTE definido mas rclone não está instalado"
fi
umask 077
mkdir -p "$BACKUP_DIR"

# Um backup por vez (cron + deploy podem coincidir).
exec 9>"$BACKUP_DIR/.lock"
flock -w 600 9 || falhar "outro backup em andamento há mais de 10 min"

# Com o lock na mão, qualquer .parcial existente é resto de execução morta.
find "$BACKUP_DIR" -maxdepth 1 -type f -name '.*.dump.parcial' -delete

carimbo="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/ijcrm-$carimbo.dump"
parcial="$BACKUP_DIR/.ijcrm-$carimbo.dump.parcial"
trap 'rm -f "$parcial"' EXIT

log "pg_dump db/ijcrm → $final"
"${COMPOSE[@]}" exec -T db pg_dump -U ijcrm -d ijcrm --format=custom --compress=6 >"$parcial"
[[ -s "$parcial" ]] || falhar "dump vazio"
"${COMPOSE[@]}" exec -T db pg_restore --list <"$parcial" >/dev/null \
  || falhar "dump ilegível (pg_restore --list falhou)"
mv "$parcial" "$final"
log "ok: $(du -h "$final" | cut -f1) $final"

if [[ -n "$BACKUP_REMOTE" ]]; then
  log "off-site: rclone copy → $BACKUP_REMOTE"
  rclone copy --no-traverse "$final" "$BACKUP_REMOTE"
  rclone delete "$BACKUP_REMOTE" --min-age "${RETENCAO_DIAS}d" --include 'ijcrm-*.dump'
else
  log "AVISO: BACKUP_REMOTE vazio — dump só neste disco (sem cópia off-site)"
fi

# -mtime +N = idade em dias inteiros > N. Com N = RETENCAO_DIAS-1 ficam os
# últimos RETENCAO_DIAS dias. Só roda se o dump acima deu certo (set -e).
apagados="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ijcrm-*.dump' \
  -mtime +"$((RETENCAO_DIAS - 1))" -print -delete | wc -l)"
log "retenção ${RETENCAO_DIAS}d: $apagados dump(s) antigo(s) removido(s)"
