#!/usr/bin/env bash
# Deploy de produção (GAB-30). Ver docs/runbook.md §1–§2.
#
#   scripts/deploy.sh [TAG] [--no-pull] [--force]   checa → git pull → docker pull → backup → migrate → up → health
#   scripts/deploy.sh --build-local [--no-pull] [--force]   idem, mas builda as imagens NESTA máquina
#   scripts/deploy.sh rollback [TAG]                app volta para TAG `sha-…`/`local-…` (padrão: o deploy bom anterior ao que roda)
#
#   TAG            imagem publicada pelo CI no GHCR (.github/workflows/imagens.yml):
#                  `sha-<commit curto>` ou `latest` (padrão). `latest` é resolvida para
#                  o `sha-…` dela (label org.opencontainers.image.revision): histórico e
#                  rollback sempre usam tags imutáveis.
#   --build-local  escape: sem CI/registry, builda aqui (tag `local-<commit>`). Pesado
#                  para uma VPS pequena (~2 GB de RAM e de disco só de build).
#   --no-pull      não roda `git pull` (compose/scripts/Caddyfile ficam como estão no disco)
#   --force        aceita árvore git suja
#
# O repo na VPS fornece só compose.prod.yml, Caddyfile e scripts; o código vem da imagem.
# .deploy/historico = deploys que passaram no health, em ordem (um por linha).
# .deploy/atual = a tag boa que DEVE estar rodando: gravada por deploy E por
# rollback bem-sucedidos. Se o deploy falha no up/health, o app volta sozinho
# para ela (não para o fim do histórico: depois de um rollback manual seria a
# versão que o operador acabou de abandonar) e o script sai com erro.
# Rollback não reescreve o histórico; `:latest` local aponta sempre para o que
# está rodando depois de um deploy/rollback bem-sucedido.
# Um deploy/rollback por vez (flock em .deploy/lock). Depois de um deploy bom,
# ficam no host só as imagens das últimas IMAGENS_MANTER (padrão 5) tags do
# histórico, a do .deploy/atual e a que está rodando.
set -euo pipefail
# shellcheck source=scripts/_comum.sh
source "$(dirname "${BASH_SOURCE[0]}")/_comum.sh"
# shellcheck source=scripts/_llm.sh
source "$(dirname "${BASH_SOURCE[0]}")/_llm.sh"

HISTORICO="$RAIZ/.deploy/historico"
ATUAL="$RAIZ/.deploy/atual"
IMAGENS_MANTER="${IMAGENS_MANTER:-5}"
[[ "$IMAGENS_MANTER" =~ ^[1-9][0-9]*$ ]] || falhar "IMAGENS_MANTER inválido: $IMAGENS_MANTER"
APP_IMAGE_PADRAO=ghcr.io/gabriel-marques-tech/ij-crm-app
OPS_IMAGE_PADRAO=ghcr.io/gabriel-marques-tech/ij-crm-ops
# Label que o docker/metadata-action grava nas imagens do CI.
ORIGEM_IMAGENS=https://github.com/Gabriel-Marques-tech/ij-crm

# Nomes das imagens como o compose resolve (shell > .env > padrão do compose.prod.yml).
resolver_imagens() {
  APP_IMAGE="$(ler_env APP_IMAGE)"; APP_IMAGE="${APP_IMAGE:-$APP_IMAGE_PADRAO}"
  OPS_IMAGE="$(ler_env OPS_IMAGE)"; OPS_IMAGE="${OPS_IMAGE:-$OPS_IMAGE_PADRAO}"
  export APP_IMAGE OPS_IMAGE
}

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
  checar_chave_llm "$(ler_env LLM_PROVEDOR)" "$(ler_env OPENAI_API_KEY)" "$(ler_env ANTHROPIC_API_KEY)" || erros=1
  [[ $erros -eq 0 ]] || falhar "corrija o .env (modelo: .env.prod.example)"
  resolver_imagens
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

# Até HEALTH_TENTATIVAS × 3 s (padrão 20 = 60 s): no 1º deploy o Caddy ainda
# está emitindo o certificado do Let's Encrypt quando o `up --wait` termina.
verificar_health() {
  local i tentativas="${HEALTH_TENTATIVAS:-20}"
  [[ "$tentativas" =~ ^[1-9][0-9]*$ ]] || falhar "HEALTH_TENTATIVAS inválido: $tentativas"
  log "health pelo Caddy: /api/health"
  for ((i = 1; i <= tentativas; i++)); do
    if curl_app /api/health -f -o /dev/null; then
      log "health 200"
      return 0
    fi
    sleep 3
  done
  log "health sem 200 em $((tentativas * 3))s. Se for TLS: DNS de APP_DOMAIN aponta para este host e as portas 80/443 estão abertas? (dc logs caddy)" >&2
  return 1
}

ultimo_bom() { tail -n 1 "$HISTORICO" 2>/dev/null || true; }

# Tag boa corrente (alvo do rollback automático). Instalação anterior a este
# arquivo: cai no fim do histórico.
bom_atual() {
  local tag
  tag="$(cat "$ATUAL" 2>/dev/null || true)"
  printf '%s' "${tag:-$(ultimo_bom)}"
}

marcar_bom_atual() {
  mkdir -p "$(dirname "$ATUAL")"
  printf '%s\n' "$1" >"$ATUAL.novo"
  mv "$ATUAL.novo" "$ATUAL"
}

# Um deploy/rollback por vez. O fd 8 fica aberto até o fim do processo (e passa
# pelo `exec` do deploy depois do git pull, que por isso não trava de novo).
travar() {
  [[ "${IJ_DEPLOY_TRAVADO:-0}" == "1" ]] && return 0
  mkdir -p "$RAIZ/.deploy"
  exec 8>"$RAIZ/.deploy/lock"
  flock -n 8 || falhar "outro deploy/rollback em andamento ($RAIZ/.deploy/lock)"
  export IJ_DEPLOY_TRAVADO=1
}

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

tem_imagem() { docker image inspect "$1" >/dev/null 2>&1; }

baixar() {
  log "docker pull $1"
  docker pull -q "$1" >/dev/null \
    || falhar "não consegui baixar $1 (a tag existe no GHCR? docker login ghcr.io feito? runbook §1)"
}

# Garante as imagens app e ops de TAG neste host (baixa do GHCR se faltar).
# Tags `local-*` (--build-local) não existem no registry: só confere.
garantir_imagens() {
  local tag="$1" img
  for img in "$APP_IMAGE:$tag" "$OPS_IMAGE:$tag"; do
    tem_imagem "$img" && continue
    [[ "$tag" == local-* ]] && falhar "imagem $img não existe neste host (build local apagado?)"
    baixar "$img"
  done
}

# Tag imutável a partir da pedida: `sha-…` passa direto; `latest` (ou outra tag
# móvel) é baixada e vira o `sha-…` do commit dela. Escreve a tag no stdout.
resolver_tag() {
  local pedida="$1" rev
  if [[ "$pedida" == sha-* || "$pedida" == local-* ]]; then
    printf '%s' "$pedida"
    return 0
  fi
  baixar "$APP_IMAGE:$pedida" >&2
  rev="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$APP_IMAGE:$pedida")"
  [[ "$rev" =~ ^[0-9a-f]{40}$ ]] \
    || falhar "$APP_IMAGE:$pedida sem label de revisão do CI; passe a tag: scripts/deploy.sh sha-<commit>"
  printf 'sha-%s' "${rev:0:7}"
}

# Disco: apaga as imagens app/ops fora das últimas IMAGENS_MANTER tags do
# histórico (a que roda fica sempre) e as órfãs delas (`latest` antigo re-baixado).
limpar_imagens() {
  local manter tag repo atual
  atual="$(tag_rodando)"
  manter="$(tail -n "$IMAGENS_MANTER" "$HISTORICO" 2>/dev/null || true; bom_atual)"
  for repo in "$APP_IMAGE" "$OPS_IMAGE"; do
    while read -r tag; do
      [[ -z "$tag" || "$tag" == "<none>" || "$tag" == latest || "$tag" == "$atual" ]] && continue
      grep -qxF "$tag" <<<"$manter" && continue
      log "limpeza: docker image rm $repo:$tag"
      docker image rm "$repo:$tag" >/dev/null || true
    done < <(docker image ls "$repo" --format '{{.Tag}}')
  done
  # Só órfãs das imagens deste repo (label do CI); outras do host ficam.
  docker image prune -f --filter "label=org.opencontainers.image.source=$ORIGEM_IMAGENS" >/dev/null || true
}

# Troca só o container `app` para a imagem TAG e confere o health.
trocar_app() {
  local tag="$1"
  garantir_imagens "$tag"
  APP_TAG="$tag" "${COMPOSE[@]}" up -d --no-build --no-deps --wait app || return 1
  verificar_health || return 1
  marcar_latest "$tag"
}

deploy() {
  local puxar=1 forcar=0 local_build=0 pedida="" arg dump_antes="" anterior
  for arg in "$@"; do
    case "$arg" in
      --no-pull) puxar=0 ;;
      --force) forcar=1 ;;
      --build-local) local_build=1 ;;
      -*) falhar "opção desconhecida: $arg" ;;
      *)
        [[ -z "$pedida" ]] || falhar "mais de uma tag: $pedida e $arg"
        pedida="$arg"
        ;;
    esac
  done
  if [[ $local_build -eq 1 && -n "$pedida" ]]; then
    falhar "--build-local não aceita TAG (a tag é local-<commit>)"
  fi
  pedida="${pedida:-latest}"

  travar
  checar_arvore "$forcar"
  if [[ $puxar -eq 1 ]]; then
    log "git pull --ff-only"
    git -C "$RAIZ" pull --ff-only
    # Re-executa a versão recém-baixada deste script.
    local repassar=(--no-pull)
    [[ $forcar -eq 1 ]] && repassar+=(--force)
    if [[ $local_build -eq 1 ]]; then repassar+=(--build-local); else repassar+=("$pedida"); fi
    exec "$RAIZ/scripts/deploy.sh" "${repassar[@]}"
  fi

  checar_env
  anterior="$(bom_atual)"
  if [[ $local_build -eq 1 ]]; then
    APP_TAG="local-$(git -C "$RAIZ" rev-parse --short=12 HEAD)"
    export APP_TAG
    log "deploy de $APP_TAG (build local; bom atual: ${anterior:-nenhum})"
    log "build das imagens app (runtime) e migrate (ops) NESTA máquina"
    "${COMPOSE[@]}" --profile ops build app migrate
  else
    APP_TAG="$(resolver_tag "$pedida")"
    export APP_TAG
    log "deploy de $APP_TAG (pedida: $pedida; bom atual: ${anterior:-nenhum})"
    garantir_imagens "$APP_TAG"
  fi

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
    log "ERRO: migration falhou. O app NÃO foi trocado: segue rodando ${anterior:-(nenhum)}." >&2
    log "      Dump de antes do deploy: ${dump_antes:-(nenhum — banco estava vazio)}" >&2
    log "      Recuperação: docs/runbook.md §2 (\"Migration falhou\"): corrigir + prisma migrate resolve, ou restaurar esse dump." >&2
    exit 1
  fi

  log "subindo a stack com $APP_IMAGE:$APP_TAG"
  if "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 300 && verificar_health; then
    registrar_deploy "$APP_TAG"
    marcar_bom_atual "$APP_TAG"
    marcar_latest "$APP_TAG"
    limpar_imagens
    log "deploy concluído: $APP_TAG"
    return 0
  fi

  log "ERRO: up/health falhou com $APP_TAG. Logs: docker compose -f compose.prod.yml logs app caddy" >&2
  if [[ -n "$anterior" && "$anterior" != "$APP_TAG" ]]; then
    log "rollback automático do app para o bom atual: $anterior (o schema NÃO volta; ver runbook §2)" >&2
    if (trocar_app "$anterior"); then
      log "rollback automático ok: app em $anterior" >&2
    else
      log "ERRO: rollback automático para $anterior também falhou — intervenção manual (runbook §2)" >&2
    fi
  elif [[ "$anterior" == "$APP_TAG" ]]; then
    log "o bom atual já é $APP_TAG: nada para voltar (o problema é config/infra, não a imagem)" >&2
  else
    log "sem deploy bom anterior para voltar automaticamente" >&2
  fi
  exit 1
}

rollback() {
  local alvo="${1:-}" atual idx
  if [[ -n "$alvo" && "$alvo" != sha-* && "$alvo" != local-* ]]; then
    # `latest` local pode ser velho (ou o que acabou de falhar): só tag imutável.
    falhar "rollback aceita só tag sha-<commit> ou local-<commit> (recebeu: $alvo)"
  fi
  travar
  carregar_ambiente
  resolver_imagens
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
  marcar_bom_atual "$alvo"
  log "rollback concluído: $alvo"
}

case "${1:-}" in
  rollback) rollback "${2:-}" ;;
  -h | --help) sed -n '2,27p' "$0" ;;
  *) deploy "$@" ;;
esac
