#!/usr/bin/env bash
# Entrada do deploy automático (GitHub Actions → AWS SSM Run Command). Ver
# docs/runbook.md, "Deploy automático (GitHub Actions + AWS SSM)".
#
#   deploy-remoto.sh <tag sha-…> <digest app sha256:…> <digest ops sha256:…>
#
# Chamado pelo documento SSM deploy/ssm-deploy.yaml, como o usuário `deploy`:
#   runuser -u deploy -- /opt/ij-crm/scripts/deploy-remoto.sh '<tag>' '<digestApp>' '<digestOps>'
# O documento já filtra os parâmetros (allowedPattern); aqui tudo é validado de
# novo, sem confiar em quem chamou:
#   - exatamente 3 argumentos: tag `^sha-[0-9a-f]{7,40}$` e dois `^sha256:[0-9a-f]{64}$`;
#   - `git fetch origin main` e o commit da tag tem de existir e ser ancestral de
#     origin/main (código revisado: a main só aceita PR);
# e então roda `scripts/deploy.sh <tag> --digest-app=… --digest-ops=…` (que baixa
# por digest e confere digest + commit da imagem) DESTACADO do canal de controle
# (`setsid`, sessão e grupo de processos próprios, stdin /dev/null): se o SSM
# estourar o tempo, for cancelado ou cair, o deploy.sh segue até o fim (nunca
# morre no meio de uma migration). Saída completa em
# /var/log/ij-crm/deploy-<UTC>-<tag>.log; no fim imprime as últimas 200 linhas
# (o SSM guarda só ~24 mil caracteres de saída).
#
# Saída: a do deploy.sh (0 = ok; ≠ 0 = falhou, inclusive com rollback automático);
# 2 = pedido recusado (nada foi executado); 1 também em erro de git antes do deploy.
set -euo pipefail
export LC_ALL=C

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${DEPLOY_LOG_DIR:-/var/log/ij-crm}"
RE_TAG='^sha-[0-9a-f]{7,40}$'
RE_DIGEST='^sha256:[0-9a-f]{64}$'

registrar() {
  # Trilha no syslog/journal: journalctl -t ij-crm-deploy (sem logger, nada).
  logger -t ij-crm-deploy -- "$*" 2>/dev/null || true
}
recusar() {
  registrar "recusado: $1"
  echo "deploy-remoto: recusado: $1" >&2
  exit 2
}

[[ $# -eq 3 ]] || recusar "esperava 3 argumentos (tag digest-app digest-ops), recebeu $#"
tag="$1" dig_app="$2" dig_ops="$3"
[[ "$tag" =~ $RE_TAG ]] || recusar "tag inválida (${#tag} caracteres; esperado sha-<7 a 40 hex minúsculos>)"
[[ "$dig_app" =~ $RE_DIGEST ]] || recusar "digest do app inválido (esperado sha256:<64 hex>)"
[[ "$dig_ops" =~ $RE_DIGEST ]] || recusar "digest do ops inválido (esperado sha256:<64 hex>)"

# runuser não troca o HOME em todo caso; git/docker leem a config do HOME.
HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
export HOME
cd "$RAIZ"

git fetch -q origin main || { echo "deploy-remoto: git fetch origin main falhou" >&2; exit 1; }
commit="$(git rev-parse -q --verify "${tag#sha-}^{commit}")" \
  || recusar "commit ${tag#sha-} não existe no repo depois do fetch (não é da main?)"
git merge-base --is-ancestor "$commit" origin/main \
  || recusar "commit $commit não está na origin/main"

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
echo "deploy-remoto: últimas linhas de $log:"
tail -n 200 "$log"
registrar "deploy de $tag terminou com código $rc"
exit "$rc"
