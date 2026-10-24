#!/usr/bin/env bash
# Backup diário dos bancos de produção (GAB-30, design §5) — chamado pelo cron do
# host (deploy/crontab.example) e pelo deploy.sh antes das migrations.
#
#   scripts/backup.sh
#
# Gera, em $BACKUP_DIR, um dump formato custom do pg_dump (comprimido, -Z 6):
#   ijcrm-<UTC>.dump       banco do CRM (o que importa)
#   evolution-<UTC>.dump   banco da Evolution (sessão/instância; sem mensagens)
# Cada dump é validado com `pg_restore --list` antes de ganhar o nome final.
# Retenção: apaga dumps com mais de $RETENCAO_DIAS dias (padrão 14).
# Restaurar: scripts/restore.sh (docs/runbook.md).
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ij-crm}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"
BACKUP_EVOLUTION="${BACKUP_EVOLUTION:-1}"

[[ "$RETENCAO_DIAS" =~ ^[1-9][0-9]*$ ]] || falhar "RETENCAO_DIAS inválido: $RETENCAO_DIAS"
umask 077
mkdir -p "$BACKUP_DIR"

# Um backup por vez (cron + deploy podem coincidir).
exec 9>"$BACKUP_DIR/.lock"
flock -w 600 9 || falhar "outro backup em andamento há mais de 10 min"

carimbo="$(date -u +%Y%m%dT%H%M%SZ)"

# despejar <serviço> <usuário> <banco> <prefixo>
despejar() {
  local servico="$1" usuario="$2" banco="$3" prefixo="$4"
  local final="$BACKUP_DIR/$prefixo-$carimbo.dump"
  local parcial="$BACKUP_DIR/.$prefixo-$carimbo.dump.parcial"
  trap 'rm -f "$parcial"' RETURN
  log "pg_dump $servico/$banco → $final"
  "${COMPOSE[@]}" exec -T "$servico" pg_dump -U "$usuario" -d "$banco" --format=custom --compress=6 >"$parcial"
  [[ -s "$parcial" ]] || falhar "dump vazio: $servico/$banco"
  "${COMPOSE[@]}" exec -T "$servico" pg_restore --list <"$parcial" >/dev/null \
    || falhar "dump ilegível (pg_restore --list falhou): $servico/$banco"
  mv "$parcial" "$final"
  log "ok: $(du -h "$final" | cut -f1) $final"
}

despejar db ijcrm ijcrm ijcrm
if [[ "$BACKUP_EVOLUTION" == "1" ]]; then
  despejar evolution-db evolution evolution evolution
fi

# -mtime +N = idade em dias inteiros > N. Com N = RETENCAO_DIAS-1 ficam os
# últimos RETENCAO_DIAS dias. Só roda se todos os dumps acima deram certo (set -e).
apagados="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'ijcrm-*.dump' -o -name 'evolution-*.dump' \) \
  -mtime +"$((RETENCAO_DIAS - 1))" -print -delete | wc -l)"
log "retenção ${RETENCAO_DIAS}d: $apagados dump(s) antigo(s) removido(s)"
