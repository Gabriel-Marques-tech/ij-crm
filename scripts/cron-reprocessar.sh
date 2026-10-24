#!/usr/bin/env bash
# Disparado pelo cron do host a cada 10 min (deploy/crontab.example):
# POST /api/cron/reprocessar com o segredo no header `x-cron-secret`.
#
# A rota é implementada no GAB-41; até lá o app responde 404 e este script sai
# com erro (fica registrado no log do cron, sem efeito colateral).
# O segredo vai pelo stdin do curl (`-H @-`), não pela linha de comando: não
# aparece em `ps` nem fica escrito no crontab.
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

segredo="$(ler_env CRON_SECRET)"
[[ ${#segredo} -ge 32 && "$segredo" != troque-me* ]] \
  || falhar "CRON_SECRET ausente ou fraco em $ARQUIVO_ENV (≥32 chars, sem 'troque-me'): openssl rand -hex 32"

if resposta="$(printf 'x-cron-secret: %s\n' "$segredo" \
  | CURL_MAX_TIME=300 curl_app /api/cron/reprocessar -X POST -H @-)"; then
  log "reprocessar ok: $resposta"
else
  falhar "reprocessar falhou (curl saiu com $?)"
fi
