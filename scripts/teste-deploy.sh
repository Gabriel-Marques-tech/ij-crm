#!/usr/bin/env bash
# Teste do scripts/deploy.sh sem Docker: docker/git/curl são stubs que guardam a
# tag "rodando" num arquivo. Cobre: deploy A, B, rollback → A, deploy C falha →
# rollback automático volta para A (não B); rollback latest recusado; lock.
#
#   bash scripts/teste-deploy.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/scripts" "$T/bin" "$T/state"
cp "$WT"/scripts/{deploy.sh,_comum.sh,_llm.sh} "$T/repo/scripts/"
cp "$WT/compose.prod.yml" "$T/repo/"
cat > "$T/bin/docker" <<'D'
#!/usr/bin/env bash
ST="$STUB_STATE"; a="$*"
echo "docker $a" >> "$ST/log"
case "$a" in
  *"config --environment"*)
    k=$(printf 'x%.0s' {1..40})
    printf '%s\n' POSTGRES_PASSWORD=$k EVOLUTION_DB_PASSWORD=$k EVOLUTION_REDIS_PASSWORD=$k \
      EVOLUTION_API_KEY=$k EVOLUTION_WEBHOOK_SECRET=$k CRON_SECRET=$k APP_DOMAIN=localhost \
      ACME_EMAIL=a@b.c LLM_PROVEDOR=openai OPENAI_API_KEY=sk-test ;;
  *"ps -q app"*) [[ -s "$ST/running" ]] && echo cid ;;
  "inspect -f {{.Config.Image}} cid") echo "img:$(cat "$ST/running")" ;;
  *"exec -T db psql"*) echo f ;;
  *" up -d --no-build"*)
    if [[ "$a" == *" app"* || "$a" == *"--wait-timeout"* ]]; then
      echo "$APP_TAG" > "$ST/running"
      [[ "$APP_TAG" == "${FAIL_TAG:-}" ]] && exit 1
    fi ;;
esac
exit 0
D
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/curl"
printf '#!/usr/bin/env bash\n[[ "$*" == *"status --porcelain"* ]] && exit 0\n[[ "$*" == *rev-parse* ]] && echo abc && exit 0\nexit 0\n' > "$T/bin/git"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" STUB_STATE="$T/state" CURL_MAX_TIME=1
D="$T/repo/scripts/deploy.sh"
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
FALHAS=0
r() { cat "$T/state/running"; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }
bash "$D" sha-aaaaaaa --no-pull >/dev/null 2>&1; ok "$(r)" sha-aaaaaaa "deploy A"
bash "$D" sha-bbbbbbb --no-pull >/dev/null 2>&1; ok "$(r)" sha-bbbbbbb "deploy B"
bash "$D" rollback >/dev/null 2>&1; ok "$(r)" sha-aaaaaaa "rollback → A"
ok "$(cat "$T/repo/.deploy/atual")" sha-aaaaaaa ".deploy/atual depois do rollback"
FAIL_TAG=sha-ccccccc bash "$D" sha-ccccccc --no-pull >"$T/c.log" 2>&1; rc=$?
ok "$rc" 1 "deploy C falha com erro"
ok "$(r)" sha-aaaaaaa "auto-rollback volta para A (não B)"
contem "$(cat "$T/c.log")" "rollback automático ok: app em sha-aaaaaaa" "log do auto-rollback"
ok "$(cat "$T/repo/.deploy/atual")" sha-aaaaaaa ".deploy/atual segue A"
ok "$(tr '\n' ' ' < "$T/repo/.deploy/historico")" "sha-aaaaaaa sha-bbbbbbb " "histórico sem C"
out="$(bash "$D" rollback latest 2>&1)"; rc=$?
ok "$rc" 1 "rollback latest recusado"; contem "$out" "só tag sha-" "mensagem do rollback latest"
exec 7>"$T/repo/.deploy/lock"; flock -n 7
out="$(bash "$D" sha-bbbbbbb --no-pull 2>&1)"; rc=$?
ok "$rc" 1 "deploy com lock ocupado"; contem "$out" "outro deploy/rollback em andamento" "mensagem do lock (deploy)"
out="$(bash "$D" rollback sha-bbbbbbb 2>&1)"; rc=$?
ok "$rc" 1 "rollback com lock ocupado"; contem "$out" "outro deploy/rollback em andamento" "mensagem do lock (rollback)"
exec 7>&-
ok "$(r)" sha-aaaaaaa "nada mudou com o lock ocupado"
# git pull + exec não trava em si mesmo
bash "$D" sha-bbbbbbb >/dev/null 2>&1; ok "$(r)" sha-bbbbbbb "deploy com git pull (re-exec mantém o lock)"
exit $FALHAS
