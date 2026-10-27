#!/usr/bin/env bash
# Teste do scripts/deploy-remoto.sh (entrada do deploy automático via SSM) sem
# AWS nem Docker: git de verdade (repo temporário + "origin" bare) e deploy.sh
# stub. Como o deploy-remoto.sh limpa o ambiente, o stub é configurado por
# arquivos em <repo>/.stub/ (rc, dorme) e grava lá argumentos, cwd e variáveis.
# Cobre: argumentos válidos repassados (tag + digests, cwd = raiz), log em
# DEPLOY_LOG_DIR, código de saída propagado (0, 1, 10, 11, 42) e a linha
# RESULTADO antes do fim do log; recusas com 2 sem rodar o deploy.sh (nº de
# argumentos, tag/digest inválidos e tentativas de injeção, commit inexistente,
# commit fora da origin/main); ref com nome de hash não substitui o commit;
# ambiente do chamador (IJ_DEPLOY_TRAVADO, GIT_DIR, APP_IMAGE, PATH, função
# exportada) não chega ao git nem ao deploy.sh; o deploy.sh segue até o fim quando
# o grupo de processos do chamador é morto (SSM cancelado/timeout).
#
#   bash scripts/teste-deploy-remoto.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
G=(git -c user.name=teste -c user.email=teste@exemplo -c init.defaultBranch=main)
export GIT_CONFIG_GLOBAL=/dev/null
mkdir -p "$T/fonte/scripts" "$T/logs"
cp "$WT/scripts/deploy-remoto.sh" "$T/fonte/scripts/"
cat > "$T/fonte/scripts/deploy.sh" <<'D'
#!/usr/bin/env bash
S="$(cd "$(dirname "$0")/.." && pwd)/.stub"
{ printf 'argc=%s\n' "$#"; printf 'arg=%s\n' "$@"; printf 'cwd=%s\n' "$PWD"; } > "$S/args"
{ printf 'IJ_DEPLOY_TRAVADO=%s\n' "${IJ_DEPLOY_TRAVADO-}"; printf 'GIT_DIR=%s\n' "${GIT_DIR-}"
  printf 'APP_IMAGE=%s\n' "${APP_IMAGE-}"; printf 'PATH=%s\n' "$PATH"; printf 'LC_ALL=%s\n' "${LC_ALL-}"
  printf 'funcoes=%s\n' "$(declare -F | tr '\n' ' ')"; } > "$S/env"
echo "saida do deploy.sh"
d="$(cat "$S/dorme" 2>/dev/null || echo 0)"; [[ "$d" != 0 ]] && /usr/bin/sleep "$d"
echo fim > "$S/fim"
exit "$(cat "$S/rc" 2>/dev/null || echo 0)"
D
chmod +x "$T/fonte/scripts/"*.sh
"${G[@]}" init -q "$T/fonte"; "${G[@]}" -C "$T/fonte" add -A; "${G[@]}" -C "$T/fonte" commit -qm v1
C1="$("${G[@]}" -C "$T/fonte" rev-parse HEAD)"
"${G[@]}" -C "$T/fonte" commit -q --allow-empty -m v2
C2="$("${G[@]}" -C "$T/fonte" rev-parse HEAD)"
"${G[@]}" clone -q --bare "$T/fonte" "$T/origin.git"
"${G[@]}" clone -q "$T/origin.git" "$T/repo"
# Commit que existe no clone mas não está na origin/main (branch local).
"${G[@]}" -C "$T/repo" checkout -q -b lateral
"${G[@]}" -C "$T/repo" commit -q --allow-empty -m lateral
CL="$("${G[@]}" -C "$T/repo" rev-parse HEAD)"
"${G[@]}" -C "$T/repo" checkout -q main
mkdir -p "$T/repo/.stub"
export DEPLOY_LOG_DIR="$T/logs" DEPLOY_SYSLOG=0
R="$T/repo/scripts/deploy-remoto.sh"
ST="$T/repo/.stub"
DA="sha256:$(printf 'a%.0s' {1..64})"
DO="sha256:$(printf 'b%.0s' {1..64})"
TAG="sha-${C1:0:7}"
FALHAS=0
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }
# Roda como o documento SSM: de outro diretório, só com argumentos. STUB_RC → .stub/rc.
rodar() {
  rm -f "$ST/args" "$ST/env" "$ST/fim"; echo "${STUB_RC:-0}" > "$ST/rc"
  (cd / && "$R" "$@")
}

out="$(rodar "$TAG" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 0 "argumentos válidos: sai 0"
ok "$(tr '\n' ' ' < "$ST/args")" "argc=3 arg=$TAG arg=--digest-app=$DA arg=--digest-ops=$DO cwd=$T/repo " "deploy.sh recebe tag + digests, na raiz do repo"
contem "$out" "saida do deploy.sh" "saída do deploy.sh aparece no fim"
contem "$out" "commit $C1" "commit resolvido no log"
contem "$out" "deploy-remoto: RESULTADO=0 ok: $TAG no ar" "linha RESULTADO do sucesso"
antes_tail="${out%%últimas linhas*}"
contem "$antes_tail" "RESULTADO=0" "RESULTADO vem antes do fim do log"
log="$(find "$T/logs" -name "deploy-*-$TAG.log" | sort | tail -n 1)"
contem "$(cat "$log" 2>/dev/null)" "saida do deploy.sh" "log completo em DEPLOY_LOG_DIR"
contem "$(cat "$log" 2>/dev/null)" "deploy.sh saiu com código 0" "log registra o código de saída"
rodar "sha-$C1" "$DA" "$DO" >/dev/null 2>&1; ok "$?" 0 "tag com o commit inteiro (40 hex) aceita"
for c in 1 10 11 42; do
  out="$(STUB_RC=$c rodar "$TAG" "$DA" "$DO" 2>&1)"; ok "$?" "$c" "código $c do deploy.sh propaga"
  contem "$out" "deploy-remoto: RESULTADO=$c " "linha RESULTADO=$c"
done
out="$(STUB_RC=10 rodar "$TAG" "$DA" "$DO" 2>&1)"
contem "$out" "rollback automático voltou o app" "RESULTADO=10 descreve o rollback ok"
out="$(STUB_RC=11 rodar "$TAG" "$DA" "$DO" 2>&1)"
contem "$out" "NÃO voltou" "RESULTADO=11 descreve a intervenção manual"

# Ambiente do chamador não vaza: variáveis e função exportada.
echo 0 > "$ST/rc"
out="$(cd / && IJ_DEPLOY_TRAVADO=1 GIT_DIR=/nao/existe APP_IMAGE=evil/imagem PATH="/tmp/nada:$PATH" \
  bash -c 'git() { echo FUNCAO-DO-CHAMADOR; exit 99; }; export -f git; rm -f "$1/args"; exec "$2" "$3" "$4" "$5"' \
  _ "$ST" "$R" "$TAG" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 0 "chamador com GIT_DIR/APP_IMAGE/IJ_DEPLOY_TRAVADO/função git: deploy ok"
ambiente="$(tr '\n' ' ' < "$ST/env" 2>/dev/null)"
contem "$ambiente" "IJ_DEPLOY_TRAVADO= " "IJ_DEPLOY_TRAVADO do chamador ignorado"
contem "$ambiente" "GIT_DIR= " "GIT_DIR do chamador ignorado"
contem "$ambiente" "APP_IMAGE= " "APP_IMAGE do chamador ignorado"
contem "$ambiente" "PATH=/usr/local/bin:/usr/bin:/bin " "PATH fixo"
contem "$ambiente" "LC_ALL=C " "LC_ALL=C"
contem "$ambiente" "funcoes= " "função exportada pelo chamador não chega"
[[ "$out" == *FUNCAO-DO-CHAMADOR* ]] && { echo "FAIL função git do chamador rodou"; FALHAS=1; }

recusa() { # recusa <rótulo> <args…>
  local rotulo="$1" out rc; shift
  out="$(rodar "$@" 2>&1)"; rc=$?
  ok "$rc" 2 "recusado: $rotulo"
  if [[ -e "$ST/args" ]]; then echo "FAIL deploy.sh rodou: $rotulo"; FALHAS=1; fi
  contem "$out" "RESULTADO=2 recusado" "mensagem de recusa: $rotulo"
}
recusa "sem argumentos"
recusa "só a tag" "$TAG"
recusa "sem o digest do ops" "$TAG" "$DA"
recusa "4 argumentos" "$TAG" "$DA" "$DO" --force
recusa "tudo num argumento só" "$TAG $DA $DO"
# shellcheck disable=SC2016  # literais de propósito: injeção que NÃO pode expandir
for t in "" latest rollback "--force" "$TAG;rm -rf /" ";rm -rf /" "$TAG && id" "$TAG\$(id)" 'sha-`id`' \
  "$TAG|id" " $TAG" "$TAG " "sha-1a2b 3c4" $'sha-1a2b3c4\nid' $'sha-1a2b3c4\n' "sha-1A2B3C4" "sha-1a2b3c" \
  "sha-$(printf 'a%.0s' {1..41})" "sha-1a2b3cg" "sha-" "${C1:0:7}" "local-${C1:0:7}" "branch-${C1:0:7}" "sha-${C1:0:7}é"; do
  recusa "tag $(printf '%q' "$t")" "$t" "$DA" "$DO"
done
for d in "" "sha256:abc" "${DA^^}" "sha512:$(printf 'a%.0s' {1..64})" "$DA;id" "$DA " "$DA"$'\n' "sha256:$(printf 'a%.0s' {1..65})"; do
  recusa "digest do app $(printf '%q' "$d")" "$TAG" "$d" "$DO"
  recusa "digest do ops $(printf '%q' "$d")" "$TAG" "$DA" "$d"
done
recusa "commit inexistente" sha-1234567 "$DA" "$DO"
out="$(rodar "sha-${CL:0:7}" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 2 "commit fora da origin/main recusado"
contem "$out" "nenhum commit da origin/main começa com ${CL:0:7}" "mensagem do commit fora da main"
[[ -e "$ST/args" ]] && { echo "FAIL deploy.sh rodou com commit fora da main"; FALHAS=1; }

# Ref com nome de hash não substitui o commit:
#  - branch chamado como o hash curto de C1, apontando para o commit lateral:
#    o deploy usa C1 (o git rev-parse daria o branch);
"${G[@]}" -C "$T/repo" branch -q "${C1:0:7}" "$CL"
out="$(rodar "$TAG" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 0 "branch com nome do hash de C1: deploy de C1 segue"
contem "$out" "commit $C1" "resolve para C1, não para o branch"
#  - tag chamada como o hash curto do commit lateral, apontando para C2 (da main):
#    recusado (o git rev-parse daria C2, que passaria no teste de ancestral).
"${G[@]}" -C "$T/repo" tag "${CL:0:7}" "$C2"
out="$(rodar "sha-${CL:0:7}" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 2 "tag com nome de hash de commit fora da main: recusado"
[[ -e "$ST/args" ]] && { echo "FAIL deploy.sh rodou com a tag que sombreia"; FALHAS=1; }

# Destacado: matar o grupo de processos do chamador (como o SSM no timeout/cancel)
# não mata o deploy.sh, que termina e registra o código no log.
rm -f "$ST/args" "$ST/fim" "$T/logs"/*; echo 0 > "$ST/rc"; echo 2 > "$ST/dorme"
(cd / && exec setsid "$R" "$TAG" "$DA" "$DO") >/dev/null 2>&1 &
chamador=$!
for _ in $(seq 1 50); do [[ -e "$ST/args" ]] && break; /usr/bin/sleep 0.1; done
kill -KILL -- "-$chamador" 2>/dev/null; wait "$chamador" 2>/dev/null
ok "$([[ -e "$ST/fim" ]] && echo terminou || echo rodando)" rodando "deploy.sh ainda rodando quando o chamador morre"
for _ in $(seq 1 50); do [[ -e "$ST/fim" ]] && break; /usr/bin/sleep 0.1; done
/usr/bin/sleep 0.2
ok "$([[ -e "$ST/fim" ]] && echo terminou || echo morreu)" terminou "deploy.sh termina mesmo com o chamador morto"
contem "$(cat "$T/logs"/deploy-*.log 2>/dev/null)" "deploy.sh saiu com código 0" "log do deploy destacado registra o fim"
exit $FALHAS
