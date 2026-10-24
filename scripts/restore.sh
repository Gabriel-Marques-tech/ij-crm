#!/usr/bin/env bash
# Restaura um dump do CRM (gerado por scripts/backup.sh) no banco de produção.
#
#   scripts/restore.sh /var/backups/ij-crm/ijcrm-20261024T031500Z.dump
#
# DESTRUTIVO: substitui o conteúdo atual do banco `ijcrm` pelo do dump.
# Pede confirmação digitando "restaurar" (ou RESTORE_CONFIRMAR=restaurar).
# Passos: valida o dump → backup de segurança do estado atual → para o app →
# pg_restore --clean numa transação só (falhou = nada muda) → sobe o app → health.
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

dump="${1:-}"
[[ -n "$dump" && -s "$dump" ]] || falhar "uso: scripts/restore.sh <arquivo ijcrm-*.dump>"

log "validando $dump"
"${COMPOSE[@]}" exec -T db pg_restore --list <"$dump" >/dev/null || falhar "dump ilegível: $dump"

confirmacao="${RESTORE_CONFIRMAR:-}"
if [[ -z "$confirmacao" ]]; then
  read -r -p "Isto SUBSTITUI o banco ijcrm pelo dump. Digite 'restaurar' para seguir: " confirmacao
fi
[[ "$confirmacao" == "restaurar" ]] || falhar "cancelado"

if [[ "${RESTORE_SEM_BACKUP:-0}" != "1" ]]; then
  log "backup de segurança do estado atual antes de restaurar"
  BACKUP_EVOLUTION=0 "$RAIZ/scripts/backup.sh"
fi

log "parando o app (sem escrita durante o restore)"
"${COMPOSE[@]}" stop app

log "pg_restore --clean --single-transaction"
if ! "${COMPOSE[@]}" exec -T db pg_restore -U ijcrm -d ijcrm --clean --if-exists --no-owner \
  --single-transaction --exit-on-error <"$dump"; then
  log "restore falhou — transação desfeita, banco segue como antes; subindo o app de volta"
  "${COMPOSE[@]}" start app
  exit 1
fi

log "subindo o app (mesmo container/imagem de antes)"
"${COMPOSE[@]}" start app
esperar_saudavel app
log "restore concluído: $dump"
