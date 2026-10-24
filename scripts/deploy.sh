#!/usr/bin/env bash
# Deploy de produção (GAB-30). Ver docs/runbook.md.
#
#   scripts/deploy.sh                  git pull → build → backup → migrate → up → health
#   scripts/deploy.sh --no-pull        idem, sem git pull (deploy do que está no disco)
#   scripts/deploy.sh rollback [TAG]   volta o app para a imagem TAG (padrão: a anterior)
#
# Imagens são marcadas com o commit (`ij-crm/app:<sha>`, `ij-crm/ops:<sha>`); o
# histórico de deploys fica em .deploy/historico (uma tag por linha, a última é
# a atual). `:latest` aponta para a última que passou no health.
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"

APP_IMAGE="${APP_IMAGE:-ij-crm/app}"
OPS_IMAGE="${OPS_IMAGE:-ij-crm/ops}"
HISTORICO="$RAIZ/.deploy/historico"
export APP_IMAGE OPS_IMAGE

# ---- checagens antes de mexer em qualquer coisa ----
checar_env() {
  local v valor erros=0
  for v in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD EVOLUTION_API_KEY EVOLUTION_WEBHOOK_SECRET CRON_SECRET; do
    valor="$(ler_env "$v")"
    if [[ ${#valor} -lt 32 || "$valor" == troque-me* ]]; then
      log "ERRO: $v ausente ou fraco (≥32 chars, sem 'troque-me'): openssl rand -hex 32" >&2
      erros=1
    fi
  done
  for v in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD; do
    # Vai dentro de uma URL postgresql:// — só caracteres que não precisam de escape.
    valor="$(ler_env "$v")"
    if [[ -n "$valor" && ! "$valor" =~ ^[A-Za-z0-9._~-]+$ ]]; then
      log "ERRO: $v tem caractere que quebra a URL do banco; use openssl rand -hex 32" >&2
      erros=1
    fi
  done
  for v in APP_DOMAIN EVOLUTION_DOMAIN ACME_EMAIL; do
    [[ -n "$(ler_env "$v")" ]] || { log "ERRO: $v vazio" >&2; erros=1; }
  done
  [[ $erros -eq 0 ]] || falhar "corrija $ARQUIVO_ENV (modelo: .env.prod.example)"
  if [[ "$(ler_env NOTIFICATIONS_ENABLED)" == "true" ]]; then
    log "NOTIFICATIONS_ENABLED=true — envios reais pelo WhatsApp LIGADOS"
  else
    log "AVISO: NOTIFICATIONS_ENABLED != true — safe mode, o bot só loga (ok para teste, não para go-live)"
  fi
}

verificar_health() {
  log "health pelo Caddy: /api/health"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl_app /api/health -o /dev/null; then
      log "health 200"
      return 0
    fi
    sleep 3
  done
  return 1
}

registrar() {
  local tag="$1"
  mkdir -p "$(dirname "$HISTORICO")"
  if [[ "$(tail -n 1 "$HISTORICO" 2>/dev/null || true)" != "$tag" ]]; then
    echo "$tag" >>"$HISTORICO"
  fi
  docker tag "$APP_IMAGE:$tag" "$APP_IMAGE:latest"
  if docker image inspect "$OPS_IMAGE:$tag" >/dev/null 2>&1; then
    docker tag "$OPS_IMAGE:$tag" "$OPS_IMAGE:latest"
  fi
}

deploy() {
  local puxar=1
  [[ "${1:-}" == "--no-pull" ]] && puxar=0

  if [[ $puxar -eq 1 ]]; then
    log "git pull --ff-only"
    git -C "$RAIZ" pull --ff-only
    # Re-executa a versão recém-baixada deste script.
    exec "$RAIZ/scripts/deploy.sh" --no-pull
  fi

  checar_env
  [[ -z "$(git -C "$RAIZ" status --porcelain --untracked-files=no)" ]] \
    || log "AVISO: há mudanças locais não commitadas; a imagem inclui o que está no disco"
  APP_TAG="$(git -C "$RAIZ" rev-parse --short=12 HEAD)"
  export APP_TAG
  log "deploy de $APP_TAG"

  log "build das imagens app (runtime) e migrate (ops)"
  "${COMPOSE[@]}" --profile ops build app migrate

  log "subindo o banco"
  "${COMPOSE[@]}" up -d --wait db

  if [[ -s "$HISTORICO" && "${DEPLOY_SEM_BACKUP:-0}" != "1" ]]; then
    log "backup antes das migrations"
    "$RAIZ/scripts/backup.sh"
  fi

  log "migrations (one-shot): prisma migrate deploy"
  "${COMPOSE[@]}" --profile ops run --rm migrate

  log "subindo a stack com $APP_IMAGE:$APP_TAG"
  "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 300

  if ! verificar_health; then
    falhar "health falhou depois do deploy de $APP_TAG. Logs: docker compose -f compose.prod.yml logs app caddy. Rollback: scripts/deploy.sh rollback"
  fi
  registrar "$APP_TAG"
  log "deploy concluído: $APP_TAG"
}

rollback() {
  local alvo="${1:-}" atual="" ultimo id
  id="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"
  [[ -n "$id" ]] && atual="$(docker inspect -f '{{.Config.Image}}' "$id")" && atual="${atual##*:}"
  ultimo="$(tail -n 1 "$HISTORICO" 2>/dev/null || true)"
  if [[ -z "$alvo" ]]; then
    if [[ -n "$ultimo" && "$atual" != "$ultimo" && "$atual" != "latest" ]]; then
      # Deploy que falhou no health não entra no histórico: volta para o último bom.
      alvo="$ultimo"
    else
      alvo="$(grep -vxF "${ultimo:-<nenhum>}" "$HISTORICO" 2>/dev/null | tail -n 1 || true)"
    fi
    [[ -n "$alvo" ]] || falhar "sem deploy anterior em $HISTORICO; passe a tag: scripts/deploy.sh rollback <tag>"
  fi
  docker image inspect "$APP_IMAGE:$alvo" >/dev/null 2>&1 || falhar "imagem $APP_IMAGE:$alvo não existe neste host"
  log "rollback do app: ${atual:-?} → $alvo (o schema do banco NÃO volta; ver runbook)"
  APP_TAG="$alvo" "${COMPOSE[@]}" up -d --no-build --no-deps --wait app
  verificar_health || falhar "health falhou no rollback para $alvo"
  registrar "$alvo"
  log "rollback concluído: $alvo"
}

case "${1:-}" in
  "" | --no-pull) deploy "${1:-}" ;;
  rollback) rollback "${2:-}" ;;
  -h | --help) sed -n '2,10p' "$0" ;;
  *) falhar "uso: scripts/deploy.sh [--no-pull] | rollback [TAG]" ;;
esac
