# shellcheck shell=bash
# Funções comuns dos scripts de operação (deploy/backup/restore/cron/evolution). Uso: `source`.
# Rodam de qualquer diretório (cron do host): tudo é relativo à raiz do repo.
#
# Variáveis que dá para sobrescrever (teste local, ver docs/runbook.md):
#   COMPOSE_PROJECT_NAME  projeto do compose (padrão: `name:` do compose.prod.yml)
#   COMPOSE_ENV_FILES     arquivo de env (padrão: <repo>/.env)
#   BACKUP_DIR            onde ficam os dumps (padrão: /var/backups/ij-crm)

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ij-crm}"
COMPOSE=(docker compose --project-directory "$RAIZ" -f "$RAIZ/compose.prod.yml")
if [[ -n "${COMPOSE_ENV_FILES:-}" ]]; then
  COMPOSE+=(--env-file "${COMPOSE_ENV_FILES%%,*}")
fi

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
falhar() { log "ERRO: $*" >&2; exit 1; }

# Ambiente de interpolação EXATAMENTE como o compose resolve (arquivo de env +
# variáveis do shell, que têm precedência): o valor checado aqui é o mesmo que
# chega no container. `carregar_ambiente` roda uma vez no topo de cada script
# (fora de subshell, senão o cache se perde); `ler_env` carrega se precisar.
_AMBIENTE_COMPOSE=""
_AMBIENTE_CARREGADO=0
carregar_ambiente() {
  _AMBIENTE_COMPOSE="$("${COMPOSE[@]}" config --environment)" \
    || falhar "docker compose config falhou (variável obrigatória ausente no .env?)"
  _AMBIENTE_CARREGADO=1
}
ler_env() {
  local nome="$1" linha
  [[ $_AMBIENTE_CARREGADO -eq 1 ]] || carregar_ambiente
  linha="$(grep -E "^${nome}=" <<<"$_AMBIENTE_COMPOSE" | tail -n 1 || true)"
  printf '%s' "${linha#*=}"
}

# Regra de segredo do app (src/lib/config/env.ts): ≥ 32 chars, sem prefixo "troque-me".
segredo_forte() {
  local valor="$1"
  [[ ${#valor} -ge 32 && "$valor" != troque-me* ]]
}

# Diretório temporário privado (umask 077) apagado na saída do script.
# Uso (fora de subshell, para o trap valer no script):
#   dir_privado [base]; echo "$DIR_PRIVADO"
# Guarda arquivos com segredo (headers/corpo do curl, PNG do QR).
_DIRS_PRIVADOS=()
_limpar_dirs_privados() {
  local d
  for d in "${_DIRS_PRIVADOS[@]}"; do rm -rf -- "$d"; done
}
DIR_PRIVADO=""
dir_privado() {
  local base="${1:-${TMPDIR:-/tmp}}"
  DIR_PRIVADO="$(umask 077 && mktemp -d "$base/.ij-crm.XXXXXXXX")"
  _DIRS_PRIVADOS+=("$DIR_PRIVADO")
  trap _limpar_dirs_privados EXIT
}

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
  [[ -n "$dominio" ]] || falhar "APP_DOMAIN vazio"
  url="https://$dominio"; [[ "$porta" == "443" ]] || url="$url:$porta"
  local extra=()
  [[ -n "${CURL_CACERT:-}" ]] && extra+=(--cacert "$CURL_CACERT")
  [[ "${CURL_INSECURE:-0}" == "1" ]] && extra+=(--insecure)
  curl -sS --max-time "${CURL_MAX_TIME:-30}" --resolve "$dominio:$porta:127.0.0.1" \
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

# Tag da imagem que o container `app` está rodando ("" se não há container).
tag_rodando() {
  local id img
  id="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"
  [[ -n "$id" ]] || return 0
  img="$(docker inspect -f '{{.Config.Image}}' "$id")"
  printf '%s' "${img##*:}"
}
