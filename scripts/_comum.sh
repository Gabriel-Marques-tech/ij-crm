# shellcheck shell=bash
# Funções comuns dos scripts de operação (deploy/backup/restore/cron). Uso: `source`.
# Rodam de qualquer diretório (cron do host): tudo é relativo à raiz do repo.
#
# Variáveis que dá para sobrescrever (teste local, ver docs/runbook.md):
#   COMPOSE_PROJECT_NAME  projeto do compose (padrão: `name:` do compose.prod.yml)
#   COMPOSE_ENV_FILES     arquivo de env (padrão: <repo>/.env)

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARQUIVO_ENV="${COMPOSE_ENV_FILES:-$RAIZ/.env}"
ARQUIVO_ENV="${ARQUIVO_ENV%%,*}"
COMPOSE=(docker compose --project-directory "$RAIZ" -f "$RAIZ/compose.prod.yml")
if [[ -n "${COMPOSE_ENV_FILES:-}" ]]; then
  COMPOSE+=(--env-file "$ARQUIVO_ENV")
fi

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
falhar() { log "ERRO: $*" >&2; exit 1; }

# curl no app PELO CADDY (TLS de verdade), resolvendo o domínio para 127.0.0.1:
# não depende de DNS e, vindo da bridge do Docker, passa no filtro de /api/cron/*.
#   curl_app <caminho> [args extras do curl]
# CURL_CACERT=<arquivo>: CA extra (teste local com a CA interna do Caddy).
# CURL_INSECURE=1: não valida o certificado — SÓ teste local, 1º deploy com CA interna.
curl_app() {
  local caminho="$1"; shift
  local dominio porta url
  dominio="$(ler_env APP_DOMAIN)"
  porta="$(ler_env HTTPS_PORT)"; porta="${porta:-443}"
  [[ -n "$dominio" ]] || falhar "APP_DOMAIN vazio em $ARQUIVO_ENV"
  url="https://$dominio"; [[ "$porta" == "443" ]] || url="$url:$porta"
  local extra=()
  [[ -n "${CURL_CACERT:-}" ]] && extra+=(--cacert "$CURL_CACERT")
  [[ "${CURL_INSECURE:-0}" == "1" ]] && extra+=(--insecure)
  curl -fsS --max-time "${CURL_MAX_TIME:-30}" --resolve "$dominio:$porta:127.0.0.1" \
    "${extra[@]}" "$@" "$url$caminho"
}

# Espera o healthcheck do Docker de um serviço ficar `healthy` (padrão 180s).
esperar_saudavel() {
  local servico="$1" limite="${2:-180}" id estado=""
  id="$("${COMPOSE[@]}" ps -q "$servico")"
  [[ -n "$id" ]] || falhar "serviço $servico não está rodando"
  for ((i = 0; i < limite; i += 3)); do
    estado="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
    [[ "$estado" == "healthy" ]] && { log "$servico healthy"; return 0; }
    sleep 3
  done
  falhar "$servico não ficou healthy em ${limite}s (estado: ${estado:-?}); veja: docker compose -f compose.prod.yml logs $servico"
}

# Lê VAR do arquivo de env SEM executar o arquivo (valores podem ter $, aspas…).
# Última ocorrência vence, como no compose. Tira aspas simples/duplas externas.
ler_env() {
  local nome="$1" linha valor
  [[ -r "$ARQUIVO_ENV" ]] || falhar "arquivo de env não encontrado: $ARQUIVO_ENV"
  linha="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${nome}=" "$ARQUIVO_ENV" | tail -n 1 || true)"
  valor="${linha#*=}"
  valor="${valor%$'\r'}"
  if [[ "$valor" =~ ^\"(.*)\"$ || "$valor" =~ ^\'(.*)\'$ ]]; then
    valor="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$valor"
}
