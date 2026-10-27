#!/usr/bin/env bash
# Teste do scripts/deploy.sh sem Docker: docker/curl são stubs que guardam a tag
# "rodando" num arquivo; o git é de verdade (repo temporário com um "origin" bare).
# Cobre: deploy A, B, rollback → A, deploy C falha → rollback automático volta
# para A (não B); rollback latest recusado; lock ocupado (desiste depois de
# LOCK_ESPERA) e lock que libera (espera e segue); HEALTH_TENTATIVAS inválido;
# health esgotado → auto-rollback; health falha na própria tag boa (sem rollback);
# arquivos do deploy vêm do commit da tag (não do HEAD da main); commit
# inexistente recusado; digests: confere, recusa digest/commit trocado, baixa por
# digest, valida formato.
# Stub do curl: CURL_FAIL_TAG=<tag> faz o health falhar enquanto essa tag roda.
# Stub do docker: imagens existem, exceto a tag STUB_AUSENTE até um `docker tag`;
# RepoDigests = <repo>@STUB_DIGEST; label de revisão = hex da tag + zeros (ou STUB_REV).
#
#   bash scripts/teste-deploy.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/fonte/scripts" "$T/bin" "$T/state"
cp "$WT"/scripts/{deploy.sh,_comum.sh,_llm.sh} "$T/fonte/scripts/"
cp "$WT/compose.prod.yml" "$T/fonte/"
printf '/.deploy/\n' > "$T/fonte/.gitignore"
G=(git -c user.name=teste -c user.email=teste@exemplo -c init.defaultBranch=main -c advice.detachedHead=false)
"${G[@]}" init -q "$T/fonte"
echo 1 > "$T/fonte/VERSAO"; "${G[@]}" -C "$T/fonte" add -A; "${G[@]}" -C "$T/fonte" commit -qm v1
C1="$("${G[@]}" -C "$T/fonte" rev-parse HEAD)"
echo 2 > "$T/fonte/VERSAO"; "${G[@]}" -C "$T/fonte" commit -qam v2
C2="$("${G[@]}" -C "$T/fonte" rev-parse HEAD)"
"${G[@]}" clone -q --bare "$T/fonte" "$T/origin.git"
"${G[@]}" clone -q "$T/origin.git" "$T/repo"
DIG0="sha256:$(printf '0%.0s' {1..64})"
DIG1="sha256:$(printf '1%.0s' {1..64})"
cat > "$T/bin/docker" <<'D'
#!/usr/bin/env bash
ST="$STUB_STATE"; a="$*"
echo "docker $a" >> "$ST/log"
DIG0="sha256:$(printf '0%.0s' {1..64})"
case "$a" in
  *"config --environment"*)
    k=$(printf 'x%.0s' {1..40})
    printf '%s\n' POSTGRES_PASSWORD=$k EVOLUTION_DB_PASSWORD=$k EVOLUTION_REDIS_PASSWORD=$k \
      EVOLUTION_API_KEY=$k EVOLUTION_WEBHOOK_SECRET=$k CRON_SECRET=$k APP_DOMAIN=localhost \
      ACME_EMAIL=a@b.c LLM_PROVEDOR=openai OPENAI_API_KEY=sk-test ;;
  *"ps -q app"*) [[ -s "$ST/running" ]] && echo cid ;;
  "inspect -f {{.Config.Image}} cid") echo "img:$(cat "$ST/running")" ;;
  *"exec -T db psql"*) echo f ;;
  "image inspect -f {{range .RepoDigests}}"*) img="${*: -1}"; echo "${img%:*}@${STUB_DIGEST:-$DIG0}" ;;
  "image inspect -f {{index .Config.Labels"*)
    img="${*: -1}"; t="${img##*:}"; h="${t#sha-}0000000000000000000000000000000000000000"
    echo "${STUB_REV:-${h:0:40}}" ;;
  "image inspect "*)
    img="${*: -1}"
    if [[ -n "${STUB_AUSENTE:-}" && "$img" == *":$STUB_AUSENTE" && ! -e "$ST/tag-$STUB_AUSENTE" ]]; then exit 1; fi ;;
  "tag "*"@sha256:"*) touch "$ST/tag-${a##*:}" ;;
  *" up -d --no-build"*)
    if [[ "$a" == *" app"* || "$a" == *"--wait-timeout"* ]]; then
      echo "$APP_TAG" > "$ST/running"
      [[ "$APP_TAG" == "${FAIL_TAG:-}" ]] && exit 1
    fi ;;
esac
exit 0
D
cat > "$T/bin/curl" <<'C'
#!/usr/bin/env bash
[[ -n "${CURL_FAIL_TAG:-}" && "$(cat "$STUB_STATE/running" 2>/dev/null)" == "$CURL_FAIL_TAG" ]] && exit 22
exit 0
C
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" STUB_STATE="$T/state" CURL_MAX_TIME=1 GIT_CONFIG_GLOBAL=/dev/null
D="$T/repo/scripts/deploy.sh"
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
FALHAS=0
r() { cat "$T/state/running"; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }
head_repo() { git -C "$T/repo" rev-parse HEAD; }
bash "$D" sha-aaaaaaa --no-pull >/dev/null 2>&1; ok "$(r)" sha-aaaaaaa "deploy A"
bash "$D" sha-bbbbbbb --no-pull >/dev/null 2>&1; ok "$(r)" sha-bbbbbbb "deploy B"
bash "$D" rollback >/dev/null 2>&1; ok "$(r)" sha-aaaaaaa "rollback → A"
ok "$(cat "$T/repo/.deploy/atual")" sha-aaaaaaa ".deploy/atual depois do rollback"
FAIL_TAG=sha-ccccccc bash "$D" sha-ccccccc --no-pull >"$T/c.log" 2>&1; rc=$?
ok "$rc" 10 "deploy C falha: código 10 (rollback automático ok)"
ok "$(r)" sha-aaaaaaa "auto-rollback volta para A (não B)"
contem "$(cat "$T/c.log")" "rollback automático ok: app em sha-aaaaaaa" "log do auto-rollback"
ok "$(cat "$T/repo/.deploy/atual")" sha-aaaaaaa ".deploy/atual segue A"
ok "$(tr '\n' ' ' < "$T/repo/.deploy/historico")" "sha-aaaaaaa sha-bbbbbbb " "histórico sem C"
out="$(bash "$D" rollback latest 2>&1)"; rc=$?
ok "$rc" 1 "rollback latest recusado"; contem "$out" "só tag sha-" "mensagem do rollback latest"
# Lock ocupado o tempo todo: espera LOCK_ESPERA e desiste sem mexer em nada.
exec 7>"$T/repo/.deploy/lock"; flock -n 7
out="$(LOCK_ESPERA=1 bash "$D" sha-bbbbbbb --no-pull 2>&1)"; rc=$?
ok "$rc" 1 "deploy com lock ocupado"; contem "$out" "aguardando o lock" "deploy avisa que está esperando"
contem "$out" "em andamento há mais de 1s" "mensagem do lock (deploy)"
out="$(LOCK_ESPERA=1 bash "$D" rollback sha-bbbbbbb 2>&1)"; rc=$?
ok "$rc" 1 "rollback com lock ocupado"; contem "$out" "em andamento há mais de 1s" "mensagem do lock (rollback)"
exec 7>&-
ok "$(r)" sha-aaaaaaa "nada mudou com o lock ocupado"
# Lock que libera em ~2 s: o segundo deploy espera e segue.
( flock 9 && /usr/bin/sleep 2 ) 9>"$T/repo/.deploy/lock" &
segurador=$!; /usr/bin/sleep 0.5
out="$(LOCK_ESPERA=30 bash "$D" sha-bbbbbbb --no-pull 2>&1)"; rc=$?
wait "$segurador"
ok "$rc" 0 "deploy espera o lock liberar e segue"; contem "$out" "lock liberado; seguindo" "log da espera do lock"
ok "$(r)" sha-bbbbbbb "deploy depois da espera do lock"
# Arquivos do deploy vêm do commit da tag (C1), não do HEAD da main (C2).
ok "$(head_repo)" "$C2" "repo começa no HEAD da main"
out="$(bash "$D" "sha-${C1:0:7}" 2>&1)"; rc=$?
ok "$rc" 0 "deploy com fetch + checkout do commit da tag"
ok "$(r)" "sha-${C1:0:7}" "tag do commit antigo rodando"
ok "$(head_repo)" "$C1" "repo em HEAD destacado no commit da tag"
ok "$(cat "$T/repo/VERSAO")" 1 "arquivos do commit da tag (não da main)"
contem "$out" "do commit $C1" "log do checkout"
bash "$D" "sha-${C2:0:7}" >/dev/null 2>&1; ok "$(head_repo)" "$C2" "deploy seguinte volta os arquivos para o commit novo"
ok "$(cat "$T/repo/VERSAO")" 2 "arquivos do commit novo"
out="$(bash "$D" sha-1234567 2>&1)"; rc=$?
ok "$rc" 1 "tag de commit inexistente recusada"; contem "$out" "nenhum commit (ou mais de um) da origin/main começa com 1234567" "mensagem do commit inexistente"
ok "$(head_repo)" "$C2" "repo não mudou com commit inexistente"
# Ref com nome de hash não substitui o commit: branch "<hash curto de C1>"
# apontando para um commit fora da main; tag "<hash do commit lateral>" → C1.
git -C "$T/repo" -c user.name=t -c user.email=t@e commit -q --allow-empty -m lateral
CL="$(git -C "$T/repo" rev-parse HEAD)"; git -C "$T/repo" checkout -q --detach "$C2"
git -C "$T/repo" branch -q "${C1:0:7}" "$CL"; git -C "$T/repo" tag "${CL:0:7}" "$C1"
out="$(bash "$D" "sha-${C1:0:7}" 2>&1)"; rc=$?
ok "$rc" 0 "branch com nome do hash de C1: deploy segue"
ok "$(head_repo)" "$C1" "checkout de C1, não do branch homônimo"
out="$(bash "$D" "sha-${CL:0:7}" 2>&1)"; rc=$?
ok "$rc" 1 "tag com nome de hash de commit fora da main: recusado"
ok "$(head_repo)" "$C1" "repo não mudou com a tag que sombreia"
bash "$D" "sha-${C2:0:7}" >/dev/null 2>&1; ok "$(head_repo)" "$C2" "volta para C2"
ok "$(r)" "sha-${C2:0:7}" "app não mudou com commit inexistente"
out="$(bash "$D" sha-XYZ --no-pull 2>&1)"; rc=$?
ok "$rc" 1 "tag sha- malformada recusada"; contem "$out" "tag inválida" "mensagem da tag malformada"
# HEALTH_TENTATIVAS inválido: recusa antes de chamar o docker
antes="$(wc -l < "$T/state/log")"
out="$(HEALTH_TENTATIVAS=abc bash "$D" sha-ddddddd --no-pull 2>&1)"; rc=$?
ok "$rc" 1 "HEALTH_TENTATIVAS inválido recusado"; contem "$out" "HEALTH_TENTATIVAS inválido" "mensagem do HEALTH_TENTATIVAS"
ok "$(wc -l < "$T/state/log")" "$antes" "nenhuma chamada ao docker com HEALTH_TENTATIVAS inválido"
bash "$D" sha-bbbbbbb --no-pull >/dev/null 2>&1; ok "$(r)" sha-bbbbbbb "volta para B"
# Health esgota as tentativas na tag nova → auto-rollback para o bom atual
CURL_FAIL_TAG=sha-ddddddd HEALTH_TENTATIVAS=2 bash "$D" sha-ddddddd --no-pull >"$T/d.log" 2>&1; rc=$?
ok "$rc" 10 "deploy D com health esgotado: código 10"
ok "$(r)" sha-bbbbbbb "auto-rollback por health volta para B"
contem "$(cat "$T/d.log")" "depois de 2 tentativas" "log do health esgotado"
contem "$(cat "$T/d.log")" "rollback automático ok: app em sha-bbbbbbb" "log do auto-rollback por health"
ok "$(cat "$T/repo/.deploy/atual")" sha-bbbbbbb ".deploy/atual segue B"
# Health falha na própria tag boa (anterior == APP_TAG): sem rollback
CURL_FAIL_TAG=sha-bbbbbbb HEALTH_TENTATIVAS=1 bash "$D" sha-bbbbbbb --no-pull >"$T/b.log" 2>&1; rc=$?
ok "$rc" 11 "redeploy de B com health falhando: código 11 (sem rollback)"
ok "$(r)" sha-bbbbbbb "app segue em B"
contem "$(cat "$T/b.log")" "sem rollback automático: esta já é a última tag boa" "mensagem de anterior == APP_TAG"
ok "$(cat "$T/repo/.deploy/atual")" sha-bbbbbbb ".deploy/atual segue B depois do redeploy falho"
# Health falha na nova e o rollback automático também falha → 11
CURL_FAIL_TAG=sha-1111111 FAIL_TAG=sha-bbbbbbb HEALTH_TENTATIVAS=1 bash "$D" sha-1111111 --no-pull >"$T/f.log" 2>&1; rc=$?
ok "$rc" 11 "rollback automático também falhou: código 11"
contem "$(cat "$T/f.log")" "rollback automático para sha-bbbbbbb também falhou" "mensagem do rollback falho"
# Digests (deploy automático)
out="$(bash "$D" sha-eeeeeee --no-pull "--digest-app=$DIG0" "--digest-ops=$DIG0" 2>&1)"; rc=$?
ok "$rc" 0 "deploy com digests que conferem"; ok "$(r)" sha-eeeeeee "app em E"
contem "$out" "confere: $DIG0" "log da conferência do digest"
antes="$(wc -l < "$T/state/log")"
out="$(bash "$D" sha-fffffff --no-pull "--digest-app=$DIG1" "--digest-ops=$DIG0" 2>&1)"; rc=$?
ok "$rc" 1 "digest do app diferente: recusado"; contem "$out" "NÃO tem o digest esperado" "mensagem do digest diferente"
ok "$(r)" sha-eeeeeee "app não mudou com digest diferente"
ok "$(tail -n +"$((antes + 1))" "$T/state/log" | grep -c -e ' up ' -e 'migrate')" 0 "digest diferente: nem banco nem migrate"
out="$(STUB_REV="$(printf 'b%.0s' {1..40})" bash "$D" sha-fffffff --no-pull "--digest-app=$DIG0" "--digest-ops=$DIG0" 2>&1)"; rc=$?
ok "$rc" 1 "imagem de outro commit (label de revisão): recusada"; contem "$out" "não do de sha-fffffff" "mensagem do commit trocado"
ok "$(r)" sha-eeeeeee "app não mudou com commit trocado"
out="$(STUB_AUSENTE=sha-9999999 bash "$D" sha-9999999 --no-pull "--digest-app=$DIG0" "--digest-ops=$DIG0" 2>&1)"; rc=$?
ok "$rc" 0 "imagem ausente: baixa por digest"; ok "$(r)" sha-9999999 "app na tag baixada por digest"
contem "$(cat "$T/state/log")" "pull -q ghcr.io/gabriel-marques-tech/ij-crm-app@$DIG0" "docker pull pelo digest (não pela tag)"
contem "$(cat "$T/state/log")" "tag ghcr.io/gabriel-marques-tech/ij-crm-app@$DIG0 ghcr.io/gabriel-marques-tech/ij-crm-app:sha-9999999" "tag local a partir do digest"
for caso in "--digest-app=$DIG0" "--digest-app=sha256:abc --digest-ops=$DIG0" "--digest-app=${DIG0^^} --digest-ops=$DIG0"; do
  # shellcheck disable=SC2086
  out="$(bash "$D" sha-eeeeeee --no-pull $caso 2>&1)"; rc=$?
  ok "$rc" 1 "digests inválidos recusados: ${caso:0:40}…"; contem "$out" "vão juntos" "mensagem dos digests inválidos"
done
out="$(bash "$D" latest --no-pull "--digest-app=$DIG0" "--digest-ops=$DIG0" 2>&1)"; rc=$?
ok "$rc" 1 "digest com latest recusado"; contem "$out" "só com TAG sha-" "mensagem do digest com latest"
ok "$(r)" sha-9999999 "nada mudou com digests inválidos"
exit $FALHAS
