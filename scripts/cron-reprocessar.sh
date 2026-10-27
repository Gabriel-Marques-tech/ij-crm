#!/usr/bin/env bash
# Disparado pelo cron do host a cada 10 min (deploy/crontab.example):
# POST /api/cron/reprocessar com o segredo no header `x-cron-secret`.
#
# A rota é implementada no GAB-41; até lá o app responde 404 e este script sai
# com erro (fica registrado no log do cron, sem efeito colateral).
# Contrato da rota (GAB-41, ver README "#crm → card"): devolve a RECEBIDA e
# chama processarMensagem para MensagemBruta em RECEBIDA há mais de N min
# (morreu antes do after()), PROCESSANDO há mais de 5 min (nunca antes: pior
# caso LLM 2×30 s + transação) e FALHA (mantendo `erro`, que marca a resposta
# como "Reprocessada").
# O segredo vai pelo stdin do curl (`-H @-`), não pela linha de comando: não
# aparece em `ps` nem fica escrito no crontab.
# Log: só horário + status HTTP. O corpo da resposta é descartado (nunca vai
# para o log, mesmo que a rota devolva algo além de contagens).
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

carregar_ambiente
segredo="$(ler_env CRON_SECRET)"
segredo_forte "$segredo" \
  || falhar "CRON_SECRET ausente ou fraco (≥32 chars, sem 'troque-me'): openssl rand -hex 32"

status="$(printf 'x-cron-secret: %s\n' "$segredo" \
  | CURL_MAX_TIME=300 curl_app /api/cron/reprocessar -X POST -H @- -o /dev/null -w '%{http_code}' || true)"
if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
  log "reprocessar HTTP $status"
else
  falhar "reprocessar HTTP ${status:-sem resposta}"
fi
