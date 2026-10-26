#!/usr/bin/env bash
# Deploy de produção (GAB-30). Ver docs/runbook.md §1–§2.
#
#   scripts/deploy.sh [--no-pull] [--force]   checa → pull → build → backup → migrate → up → health
#   scripts/deploy.sh rollback [TAG]          app volta para TAG (padrão: o deploy bom anterior ao que roda)
#
#   --no-pull  deploy do commit que está no disco (sem git pull)
#   --force    aceita árvore git suja (mudanças/arquivos não commitados entram na imagem)
#
# Imagens são marcadas com o commit (`ij-crm/app:<sha>`, `ij-crm/ops:<sha>`).
# .deploy/historico = deploys que passaram no health, em ordem (um por linha; o
# último é o "último bom"). Rollback não reescreve o histórico; `:latest` aponta
# sempre para o que está rodando depois de um deploy/rollback bem-sucedido.
# Se o deploy falha no up/health, o app volta sozinho para o último bom e o
# script sai com erro.
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
  carregar_ambiente
  for v in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD EVOLUTION_REDIS_PASSWORD \
    EVOLUTION_API_KEY EVOLUTION_WEBHOOK_SECRET CRON_SECRET; do
    if ! segredo_forte "$(ler_env "$v")"; then
      log "ERRO: $v ausente ou fraco (≥32 chars, sem 'troque-me'): openssl rand -hex 32" >&2
      erros=1
    fi
  done
  for v in POSTGRES_PASSWORD EVOLUTION_DB_PASSWORD EVOLUTION_REDIS_PASSWORD; do
    # Vai dentro de uma URL postgresql:// ou redis:// — só caracteres sem escape.
    valor="$(ler_env "$v")"
    if [[ -n "$valor" && ! "$valor" =~ ^[A-Za-z0-9._~-]+$ ]]; then
      log "ERRO: $v tem caractere que quebra a URL de conexão; use openssl rand -hex 32" >&2
      erros=1
    fi
  done
  for v in APP_DOMAIN ACME_EMAIL; do
    [[ -n "$(ler_env "$v")" ]] || { log "ERRO: $v vazio" >&2; erros=1; }
  done
  [[ $erros -eq 0 ]] || falhar "corrija o .env (modelo: .env.prod.example)"
  if [[ "$(ler_env NOTIFICATIONS_ENABLED)" == "true" ]]; then
    log "NOTIFICATIONS_ENABLED=true — envios reais pelo WhatsApp LIGADOS"
  else
    log "AVISO: NOTIFICATIONS_ENABLED != true — safe mode, o bot só loga (ok para teste, não para go-live)"
  fi
}

checar_arvore() {
  local forcar="$1" sujo
  sujo="$(git -C "$RAIZ" status --porcelain)"
  [[ -z "$sujo" ]] && return 0
  if [[ "$forcar" -eq 1 ]]; then
    log "AVISO (--force): árvore suja, a imagem inclui o que está no disco:"
    printf '%s\n' "$sujo" | head -n 20
  else
    printf '%s\n' "$sujo" | head -n 20 >&2
    falhar "árvore git com mudanças/arquivos não commitados (acima). Commite/limpe ou use --force"
  fi
}

verificar_health() {
  log "health pelo Caddy: /api/health"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl_app /api/health -f -o /dev/null; then
      log "health 200"
      return 0
    fi
    sleep 3
  done
  return 1
}

ultimo_bom() { tail -n 1 "$HISTORICO" 2>/dev/null || true; }

registrar_deploy() {
  local tag="$1" outros
  mkdir -p "$(dirname "$HISTORICO")"
  # Mesma tag de novo (redeploy) vai para o fim, sem duplicar.
  outros="$(grep -vxF "$tag" "$HISTORICO" 2>/dev/null || true)"
  { [[ -n "$outros" ]] && printf '%s\n' "$outros"; printf '%s\n' "$tag"; } >"$HISTORICO.novo"
  mv "$HISTORICO.novo" "$HISTORICO"
}

marcar_latest() {
  local tag="$1"
  docker tag "$APP_IMAGE:$tag" "$APP_IMAGE:latest"
  if docker image inspect "$OPS_IMAGE:$tag" >/dev/null 2>&1; then
    docker tag "$OPS_IMAGE:$tag" "$OPS_IMAGE:latest"
  fi
}

banco_tem_dados() {
  [[ "$("${COMPOSE[@]}" exec -T db psql -U ijcrm -d ijcrm -tAc \
    "select to_regclass('public._prisma_migrations') is not null")" == "t" ]]
}

# Troca só o container `app` para a imagem TAG (já existente) e confere o health.
trocar_app() {
  local tag="$1"
  docker image inspect "$APP_IMAGE:$tag" >/dev/null 2>&1 || falhar "imagem $APP_IMAGE:$tag não existe neste host"
  APP_TAG="$tag" "${COMPOSE[@]}" up -d --no-build --no-deps --wait app || return 1
  verificar_health || return 1
  marcar_latest "$tag"
}

deploy() {
  local puxar=1 forcar=0 arg dump_antes="" ultimo
  for arg in "$@"; do
    case "$arg" in
      --no-pull) puxar=0 ;;
      --force) forcar=1 ;;
      *) falhar "opção desconhecida: $arg" ;;
    esac
  done

  checar_arvore "$forcar"
  if [[ $puxar -eq 1 ]]; then
    log "git pull --ff-only"
    git -C "$RAIZ" pull --ff-only
    # Re-executa a versão recém-baixada deste script.
    local repassar=(--no-pull)
    [[ $forcar -eq 1 ]] && repassar+=(--force)
    exec "$RAIZ/scripts/deploy.sh" "${repassar[@]}"
  fi

  checar_env
  APP_TAG="$(git -C "$RAIZ" rev-parse --short=12 HEAD)"
  export APP_TAG
  ultimo="$(ultimo_bom)"
  log "deploy de $APP_TAG (último bom: ${ultimo:-nenhum})"

  log "build das imagens app (runtime) e migrate (ops)"
  "${COMPOSE[@]}" --profile ops build app migrate

  log "subindo o banco"
  "${COMPOSE[@]}" up -d --wait db

  if banco_tem_dados; then
    log "backup antes das migrations"
    "$RAIZ/scripts/backup.sh"
    # Nome tem carimbo UTC ordenável: o maior é o recém-criado.
    dump_antes="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ijcrm-*.dump' | sort | tail -n 1)"
  else
    log "banco vazio (sem _prisma_migrations): sem backup antes das migrations"
  fi

  log "migrations (one-shot): prisma migrate deploy"
  if ! "${COMPOSE[@]}" --profile ops run --rm migrate; then
    log "ERRO: migration falhou. O app NÃO foi trocado: segue rodando ${ultimo:-(nenhum)}." >&2
    log "      Dump de antes do deploy: ${dump_antes:-(nenhum — banco estava vazio)}" >&2
    log "      Recuperação: docs/runbook.md §2 (\"Migration falhou\"): corrigir + prisma migrate resolve, ou restaurar esse dump." >&2
    exit 1
  fi

  log "subindo a stack com $APP_IMAGE:$APP_TAG"
  if "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 300 && verificar_health; then
    registrar_deploy "$APP_TAG"
    marcar_latest "$APP_TAG"
    log "deploy concluído: $APP_TAG"
    return 0
  fi

  log "ERRO: up/health falhou com $APP_TAG. Logs: docker compose -f compose.prod.yml logs app caddy" >&2
  if [[ -n "$ultimo" && "$ultimo" != "$APP_TAG" ]]; then
    log "rollback automático do app para o último bom: $ultimo (o schema NÃO volta; ver runbook §2)" >&2
    if trocar_app "$ultimo"; then
      log "rollback automático ok: app em $ultimo" >&2
    else
      log "ERRO: rollback automático para $ultimo também falhou — intervenção manual (runbook §2)" >&2
    fi
  else
    log "sem deploy bom anterior para voltar automaticamente" >&2
  fi
  exit 1
}

rollback() {
  local alvo="${1:-}" atual idx
  atual="$(tag_rodando)"
  if [[ -z "$alvo" ]]; then
    [[ -s "$HISTORICO" ]] || falhar "sem histórico em $HISTORICO; passe a tag: scripts/deploy.sh rollback <tag>"
    idx="$(grep -nxF "${atual:-<nenhum>}" "$HISTORICO" | tail -n 1 | cut -d: -f1 || true)"
    if [[ -z "$idx" ]]; then
      # O que roda não é um deploy bom (ex.: falhou e o auto-rollback também): volta ao último bom.
      alvo="$(ultimo_bom)"
    elif [[ "$idx" -le 1 ]]; then
      falhar "app já está no deploy bom mais antigo do histórico ($atual); passe a tag explicitamente"
    else
      alvo="$(sed -n "$((idx - 1))p" "$HISTORICO")"
    fi
  fi
  [[ "$alvo" != "$atual" ]] || falhar "app já está rodando $alvo"
  log "rollback do app: ${atual:-?} → $alvo (o schema do banco NÃO volta; ver runbook §2)"
  trocar_app "$alvo" || falhar "health falhou no rollback para $alvo"
  log "rollback concluído: $alvo"
}

case "${1:-}" in
  rollback) rollback "${2:-}" ;;
  -h | --help) sed -n '2,16p' "$0" ;;
  *) deploy "$@" ;;
esac
