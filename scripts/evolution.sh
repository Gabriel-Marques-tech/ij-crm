#!/usr/bin/env bash
# Operação da instância da Evolution em produção (GAB-30, runbook §4–§5).
# Roda NA VPS: fala com a Evolution em http://127.0.0.1:$EVOLUTION_HOST_PORT
# (a Evolution não tem rota pública). Lê chave/segredos do .env via compose;
# nenhum segredo vai na linha de comando do curl (headers e corpo em arquivos
# de um diretório privado, apagado na saída).
#
#   scripts/evolution.sh criar      cria a instância EVOLUTION_INSTANCE (1ª vez)
#   scripts/evolution.sh qr         QR para parear (terminal com qrencode; senão PNG privado)
#   scripts/evolution.sh estado     connectionState ("open" = conectado)
#   scripts/evolution.sh webhook    aponta o webhook da instância para o app (rede interna)
#   scripts/evolution.sh grupos     lista JID + nome dos grupos (para GRUPO_JID)
#   scripts/evolution.sh logout     desconecta o número atual (troca de número)
#
# Alternativa visual para o QR: túnel SSH + manager (runbook §5).
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"
umask 077 # arquivos com segredo/QR: só o dono lê

carregar_ambiente
chave="$(ler_env EVOLUTION_API_KEY)"
instancia="$(ler_env EVOLUTION_INSTANCE)"; instancia="${instancia:-ij-crm}"
porta="$(ler_env EVOLUTION_HOST_PORT)"; porta="${porta:-8080}"
segredo_forte "$chave" || falhar "EVOLUTION_API_KEY ausente ou fraco no .env"
[[ "$instancia" =~ ^[A-Za-z0-9_-]+$ ]] || falhar "EVOLUTION_INSTANCE inválido: $instancia"
base="http://127.0.0.1:$porta"

dir_privado
headers="$DIR_PRIVADO/headers"
printf 'apikey: %s\ncontent-type: application/json\n' "$chave" >"$headers"

# evo <método> <caminho> [arquivo de corpo]
evo() {
  local metodo="$1" caminho="$2" corpo="${3:-}"
  local args=(-sS --fail-with-body -X "$metodo" -H "@$headers")
  [[ -n "$corpo" ]] && args+=(--data "@$corpo")
  curl "${args[@]}" "$base$caminho"
}

json_campo() { # extrai um campo string simples do JSON no stdin, sem depender de jq
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

case "${1:-}" in
  criar)
    corpo="$DIR_PRIVADO/corpo.json"
    printf '{"instanceName":"%s","integration":"WHATSAPP-BAILEYS","qrcode":false}' "$instancia" >"$corpo"
    evo POST /instance/create "$corpo" >/dev/null
    log "instância $instancia criada; agora: scripts/evolution.sh qr"
    ;;
  qr)
    resposta="$(evo GET "/instance/connect/$instancia")"
    codigo="$(json_campo code <<<"$resposta")"
    [[ -n "$codigo" ]] || falhar "sem QR na resposta (instância já conectada? veja: scripts/evolution.sh estado)"
    if command -v qrencode >/dev/null; then
      qrencode -t ansiutf8 <<<"$codigo"
      log "escaneie: WhatsApp → Dispositivos conectados → Conectar dispositivo (expira em segundos; rode de novo se precisar)"
    else
      # PNG num diretório privado no HOME do operador, apagado ao sair deste script.
      dir_privado "$HOME"
      png="$DIR_PRIVADO/qr.png"
      json_campo base64 <<<"$resposta" | sed 's/^data:image\/png;base64,//' | base64 -d >"$png"
      log "QR em $png (só você lê; é APAGADO quando você apertar Enter)."
      log "Copie para ver: scp <vps>:$png /tmp/ — e apague a cópia depois. Melhor: apt install qrencode."
      read -r -p "Enter depois de escanear... " _
    fi
    ;;
  estado)
    evo GET "/instance/connectionState/$instancia"; echo
    ;;
  webhook)
    segredo_webhook="$(ler_env EVOLUTION_WEBHOOK_SECRET)"
    segredo_forte "$segredo_webhook" || falhar "EVOLUTION_WEBHOOK_SECRET ausente ou fraco no .env"
    corpo="$DIR_PRIVADO/corpo.json"
    printf '{"webhook":{"enabled":true,"url":"http://app:3000/api/webhooks/evolution","byEvents":false,"base64":false,"headers":{"x-webhook-secret":"%s"},"events":["MESSAGES_UPSERT"]}}' \
      "$segredo_webhook" >"$corpo"
    evo POST "/webhook/set/$instancia" "$corpo" >/dev/null
    log "webhook de $instancia → http://app:3000/api/webhooks/evolution (header x-webhook-secret)"
    ;;
  grupos)
    resposta="$(evo GET "/group/fetchAllGroups/$instancia?getParticipants=false")"
    if command -v jq >/dev/null; then
      jq -r '.[] | "\(.id)\t\(.subject)"' <<<"$resposta"
    else
      printf '%s\n' "$resposta"
    fi
    ;;
  logout)
    evo DELETE "/instance/logout/$instancia" >/dev/null
    log "número desconectado de $instancia; para conectar outro: scripts/evolution.sh qr"
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 1
    ;;
esac
