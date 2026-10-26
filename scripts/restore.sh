#!/usr/bin/env bash
# Restaura um dump do CRM (gerado por scripts/backup.sh) no banco de produção.
#
#   scripts/restore.sh /var/backups/ij-crm/ijcrm-20261024T061500Z.dump
#
# DESTRUTIVO: substitui o conteúdo atual do banco `ijcrm` pelo do dump.
# Pede confirmação digitando "restaurar" (ou RESTORE_CONFIRMAR=restaurar).
# Passos: valida o dump (nome ijcrm-*.dump + tabelas do CRM) → backup de
# segurança do estado atual → para o app → pg_restore --clean numa transação só
# (falhou = nada muda) → prisma migrate deploy (dump antigo + imagem nova) →
# sobe o app → health.
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

dump="${1:-}"
[[ -n "$dump" && -s "$dump" ]] || falhar "uso: scripts/restore.sh <arquivo ijcrm-*.dump>"
[[ "$(basename -- "$dump")" == ijcrm-*.dump ]] \
  || falhar "recusado: $dump não é um dump do CRM (esperado ijcrm-*.dump)"

log "validando $dump"
indice="$("${COMPOSE[@]}" exec -T db pg_restore --list <"$dump")" || falhar "dump ilegível: $dump"
for tabela in oportunidade fase usuario _prisma_migrations; do
  grep -qE "TABLE (DATA )?public ${tabela} " <<<"$indice" \
    || falhar "recusado: dump não tem a tabela '$tabela' — não parece um backup do CRM"
done

confirmacao="${RESTORE_CONFIRMAR:-}"
if [[ -z "$confirmacao" ]]; then
  read -r -p "Isto SUBSTITUI o banco ijcrm pelo dump. Digite 'restaurar' para seguir: " confirmacao
fi
[[ "$confirmacao" == "restaurar" ]] || falhar "cancelado"

if [[ "${RESTORE_SEM_BACKUP:-0}" != "1" ]]; then
  log "backup de segurança do estado atual antes de restaurar"
  "$RAIZ/scripts/backup.sh"
fi

# Tag do app ANTES de parar (`compose ps` só lista containers rodando).
tag="$(tag_rodando)"

log "parando o app (sem escrita durante o restore)"
"${COMPOSE[@]}" stop app

log "pg_restore --clean --single-transaction"
if ! "${COMPOSE[@]}" exec -T db pg_restore -U ijcrm -d ijcrm --clean --if-exists --no-owner \
  --single-transaction --exit-on-error <"$dump"; then
  log "restore falhou — transação desfeita, banco segue como antes; subindo o app de volta"
  "${COMPOSE[@]}" start app
  exit 1
fi

# O dump pode ser de antes de migrations que a imagem atual já espera.
# Usa a imagem ops da MESMA tag que o app estava rodando.
log "prisma migrate deploy (one-shot, tag ${tag:-latest})"
if ! APP_TAG="${tag:-latest}" "${COMPOSE[@]}" --profile ops run --rm migrate; then
  falhar "dados restaurados, mas migrate deploy falhou; o app segue PARADO. Veja docs/runbook.md §2 (migration falhou)"
fi

log "subindo o app (mesmo container/imagem de antes)"
"${COMPOSE[@]}" start app
esperar_saudavel app
log "restore concluído: $dump"
