#!/usr/bin/env bash
# Disparado pelo cron do host a cada 10 min (deploy/crontab.example):
# POST /api/cron/reprocessar com o segredo no header `x-cron-secret`.
#
# Rota do GAB-41 (`src/app/api/cron/reprocessar/route.ts`, contrato no README
# "Painel de mensagens e cron"): retoma RECEBIDA órfã (> 2 min), PROCESSANDO
# travada (> 5 min), FALHA com < 3 tentativas ou sem crédito (mantendo `erro`,
# que marca a resposta como "Reprocessada"), no máximo 20 por execução; apaga o
# JSON da LLM com mais de 90 dias, prévias de import vencidas e sessões
# expiradas; apaga sem-#crm não confirmadas com mais de 30 dias; gera/limpa os
# resumos do contexto de 12 h (GAB-49). Uma execução
# por vez (trava por aluguel em trava_cron, 9 min): se a anterior ainda roda,
# responde 200 sem fazer nada. 500 = algum passo falhou (ref no log do app).
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
