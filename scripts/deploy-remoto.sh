#!/usr/bin/env bash
# Entrada do deploy automático (GitHub Actions → AWS SSM Run Command). Ver
# docs/runbook.md, "Deploy automático (GitHub Actions + AWS SSM)".
#
#   deploy-remoto.sh <tag sha-…> <digest app sha256:…> <digest ops sha256:…>
#
# Chamado pelo documento SSM deploy/ssm-deploy.yaml, como o usuário `deploy` e
# com ambiente limpo:
#   runuser -u deploy -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/deploy LC_ALL=C \
#     /opt/ij-crm/scripts/deploy-remoto.sh '<tag>' '<digestApp>' '<digestOps>'
# Mesmo chamado de outro jeito, este script se re-executa com `env -i` (PATH,
# HOME do usuário e LC_ALL=C fixos) se herdou qualquer outra variável ou função
# exportada: nada do chamador (IJ_DEPLOY_TRAVADO, GIT_DIR, APP_IMAGE…) chega ao
# git nem ao deploy.sh. Só passam DEPLOY_LOG_DIR e DEPLOY_SYSLOG (usados pelos
# testes; inofensivos).
#
# O documento já filtra os parâmetros (allowedPattern); aqui tudo é validado de
# novo, sem confiar em quem chamou:
#   - exatamente 3 argumentos: tag `^sha-[0-9a-f]{7,40}$` e dois `^sha256:[0-9a-f]{64}$`;
#   - `git fetch origin main` e o commit é o ÚNICO da história de origin/main
#     cujo sha começa com o hex da tag (por prefixo, nunca por nome de ref: um
#     branch/tag chamado como o hash não o substitui). Código na main passou por PR.
# Então roda `scripts/deploy.sh <tag> --digest-app=… --digest-ops=…` (que baixa
# por digest e confere digest + commit da imagem) DESTACADO do canal de controle
# (`setsid`, sessão e grupo de processos próprios, stdin /dev/null): se o SSM
# estourar o tempo, for cancelado ou cair, o deploy.sh segue até o fim (nunca
# morre no meio de uma migration). Saída completa em
# /var/log/ij-crm/deploy-<UTC>-<tag>.log.
#
# Saída (stdout), na ordem: linhas de contexto, depois UMA linha
#   deploy-remoto: RESULTADO=<código> <descrição>
# logo depois que o deploy.sh termina (antes do fim do log, que o SSM pode
# truncar) e as últimas 200 linhas do log.
# Código de saída: o do deploy.sh (0 ok; 1 falhou antes de trocar o app; 10
# falhou e o rollback automático voltou o app; 11 falhou e o app NÃO voltou),
# ou 2 = pedido recusado aqui (nada foi executado). O Actions classifica por ele.

# ---- ambiente limpo (antes de qualquer outra coisa) ----
LIMPO_PATH=/usr/local/bin:/usr/bin:/bin
casa="$(/usr/bin/getent passwd "$(/usr/bin/id -u)" | /usr/bin/cut -d: -f6)"
ambiente_limpo() {
  local v
  [[ "${PATH-}" == "$LIMPO_PATH" && "${HOME-}" == "$casa" && "${LC_ALL-}" == C ]] || return 1
  # Função exportada pelo chamador (BASH_FUNC_*) vira função aqui: não pode haver.
  [[ "$(declare -F | grep -v -x -e 'declare -f ambiente_limpo')" == "" ]] || return 1
  for v in $(compgen -e); do
    case "$v" in
      PATH | HOME | LC_ALL | PWD | OLDPWD | SHLVL | _ | DEPLOY_LOG_DIR | DEPLOY_SYSLOG) ;;
      *) return 1 ;;
    esac
  done
}
if ! ambiente_limpo; then
  manter=()
  [[ -n "${DEPLOY_LOG_DIR:-}" ]] && manter+=("DEPLOY_LOG_DIR=$DEPLOY_LOG_DIR")
  [[ -n "${DEPLOY_SYSLOG:-}" ]] && manter+=("DEPLOY_SYSLOG=$DEPLOY_SYSLOG")
  exec /usr/bin/env -i PATH="$LIMPO_PATH" HOME="$casa" LC_ALL=C "${manter[@]}" /bin/bash "$0" "$@"
fi
unset -f ambiente_limpo

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${DEPLOY_LOG_DIR:-/var/log/ij-crm}"
RE_TAG='^sha-[0-9a-f]{7,40}$'
RE_DIGEST='^sha256:[0-9a-f]{64}$'

registrar() {
  # Trilha no syslog/journal: journalctl -t ij-crm-deploy (DEPLOY_SYSLOG=0 desliga).
  [[ "${DEPLOY_SYSLOG:-1}" == 0 ]] && return 0
  logger -t ij-crm-deploy -- "$*" 2>/dev/null || true
}
recusar() {
  registrar "recusado: $1"
  echo "deploy-remoto: RESULTADO=2 recusado: $1"
  echo "deploy-remoto: recusado: $1" >&2
  exit 2
}

[[ $# -eq 3 ]] || recusar "esperava 3 argumentos (tag digest-app digest-ops), recebeu $#"
tag="$1" dig_app="$2" dig_ops="$3"
[[ "$tag" =~ $RE_TAG ]] || recusar "tag inválida (${#tag} caracteres; esperado sha-<7 a 40 hex minúsculos>)"
[[ "$dig_app" =~ $RE_DIGEST ]] || recusar "digest do app inválido (esperado sha256:<64 hex>)"
[[ "$dig_ops" =~ $RE_DIGEST ]] || recusar "digest do ops inválido (esperado sha256:<64 hex>)"
hex="${tag#sha-}"
cd "$RAIZ"

git fetch -q origin main || { echo "deploy-remoto: RESULTADO=1 git fetch origin main falhou"; exit 1; }
# Por prefixo do sha na história de origin/main (ref totalmente qualificada).
achados="$(git rev-list refs/remotes/origin/main -- | grep -E "^$hex" || true)"
[[ -n "$achados" ]] || recusar "nenhum commit da origin/main começa com $hex"
[[ "$(grep -c . <<<"$achados")" -eq 1 ]] || recusar "mais de um commit da origin/main começa com $hex; use uma tag mais longa"
commit="$achados"
[[ "$commit" =~ ^[0-9a-f]{40}$ && "$commit" == "$hex"* ]] || recusar "commit resolvido ($commit) não corresponde a $hex"

mkdir -p "$LOG_DIR"
log="$LOG_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$tag.log"
(umask 027 && : >"$log")
registrar "deploy de $tag (commit $commit), log $log"
echo "deploy-remoto: deploy de $tag (commit $commit); log completo: $log"

# Destacado: sessão própria (setsid), sem stdin, ignorando SIGHUP. -w: o setsid
# espera o filho e devolve o código dele mesmo quando precisa fazer fork.
# shellcheck disable=SC2016  # o bash -c filho expande "$@"/$LOG, não este
LOG="$log" setsid -w bash -c '
  trap "" HUP
  "$@" </dev/null >>"$LOG" 2>&1
  rc=$?
  echo "[deploy-remoto] deploy.sh saiu com código $rc" >>"$LOG"
  exit "$rc"
' deploy-remoto-filho "$RAIZ/scripts/deploy.sh" "$tag" "--digest-app=$dig_app" "--digest-ops=$dig_ops" &
filho=$!
set +e
wait "$filho"
rc=$?
set -e
case "$rc" in
  0) desc="ok: $tag no ar" ;;
  1) desc="falhou antes de trocar o app (checagens, pull/digest, backup ou migration); app anterior segue no ar" ;;
  10) desc="up/health falhou; rollback automático voltou o app para a versão anterior" ;;
  11) desc="up/health falhou e o app NÃO voltou: intervenção manual (runbook §2)" ;;
  *) desc="deploy.sh saiu com código inesperado" ;;
esac
echo "deploy-remoto: RESULTADO=$rc $desc"
echo "deploy-remoto: últimas linhas de $log:"
tail -n 200 "$log"
registrar "deploy de $tag terminou com código $rc"
exit "$rc"
