#!/usr/bin/env bash
# Teste do scripts/deploy-remoto.sh (entrada do deploy automático via SSM) sem
# AWS nem Docker: git de verdade (repo temporário + "origin" bare) e deploy.sh
# stub que grava argumentos/cwd, dorme STUB_DORME s e sai com STUB_RC.
# Cobre: argumentos válidos repassados (tag + digests, cwd = raiz), log em
# DEPLOY_LOG_DIR, código de saída propagado (0, 1, 42), recusas com 2 sem rodar o
# deploy.sh (nº de argumentos, tag/digest inválidos e tentativas de injeção,
# commit inexistente, commit fora da origin/main) e o deploy.sh seguindo até o
# fim quando o grupo de processos do chamador é morto (SSM cancelado/timeout).
#
#   bash scripts/teste-deploy-remoto.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
G=(git -c user.name=teste -c user.email=teste@exemplo -c init.defaultBranch=main)
export GIT_CONFIG_GLOBAL=/dev/null
mkdir -p "$T/fonte/scripts" "$T/bin" "$T/logs"
cp "$WT/scripts/deploy-remoto.sh" "$T/fonte/scripts/"
cat > "$T/fonte/scripts/deploy.sh" <<'D'
#!/usr/bin/env bash
{ printf 'argc=%s\n' "$#"; printf 'arg=%s\n' "$@"; printf 'cwd=%s\n' "$PWD"; } > "$STUB_ARGS"
echo "saida do deploy.sh"
[[ "${STUB_DORME:-0}" != 0 ]] && /usr/bin/sleep "$STUB_DORME"
echo fim > "$STUB_ARGS.fim"
exit "${STUB_RC:-0}"
D
chmod +x "$T/fonte/scripts/"*.sh
"${G[@]}" init -q "$T/fonte"; "${G[@]}" -C "$T/fonte" add -A; "${G[@]}" -C "$T/fonte" commit -qm v1
C1="$("${G[@]}" -C "$T/fonte" rev-parse HEAD)"
"${G[@]}" clone -q --bare "$T/fonte" "$T/origin.git"
"${G[@]}" clone -q "$T/origin.git" "$T/repo"
# Commit que existe no clone mas não está na origin/main (branch local).
"${G[@]}" -C "$T/repo" checkout -q -b lateral
"${G[@]}" -C "$T/repo" commit -q --allow-empty -m lateral
CL="$("${G[@]}" -C "$T/repo" rev-parse HEAD)"
"${G[@]}" -C "$T/repo" checkout -q main
# logger de mentira: não suja o journal de quem roda o teste.
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/logger"
chmod +x "$T/bin/logger"
export PATH="$T/bin:$PATH" STUB_ARGS="$T/args" DEPLOY_LOG_DIR="$T/logs"
R="$T/repo/scripts/deploy-remoto.sh"
DA="sha256:$(printf 'a%.0s' {1..64})"
DO="sha256:$(printf 'b%.0s' {1..64})"
TAG="sha-${C1:0:7}"
FALHAS=0
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }
# Roda como o documento SSM: de outro diretório, só com argumentos.
rodar() { rm -f "$STUB_ARGS" "$STUB_ARGS.fim"; (cd / && STUB_RC="${STUB_RC:-0}" "$R" "$@"); }

out="$(rodar "$TAG" "$DA" "$DO" 2>&1)"; rc=$?
ok "$rc" 0 "argumentos válidos: sai 0"
ok "$(tr '\n' ' ' < "$STUB_ARGS")" "argc=3 arg=$TAG arg=--digest-app=$DA arg=--digest-ops=$DO cwd=$T/repo " "deploy.sh recebe tag + digests, na raiz do repo"
contem "$out" "saida do deploy.sh" "saída do deploy.sh aparece no fim"
contem "$out" "commit $C1" "commit resolvido no log"
log="$(find "$T/logs" -name "deploy-*-$TAG.log" | sort | tail -n 1)"
contem "$(cat "$log" 2>/dev/null)" "saida do deploy.sh" "log completo em DEPLOY_LOG_DIR"
contem "$(cat "$log" 2>/dev/null)" "deploy.sh saiu com código 0" "log registra o código de saída"
rodar "sha-$C1" "$DA" "$DO" >/dev/null 2>&1; ok "$?" 0 "tag com o commit inteiro (40 hex) aceita"
STUB_RC=1 rodar "$TAG" "$DA" "$DO" >/dev/null 2>&1; ok "$?" 1 "falha do deploy.sh (1, ex.: rollback automático) propaga"
STUB_RC=42 rodar "$TAG" "$DA" "$DO" >/dev/null 2>&1; ok "$?" 42 "código arbitrário do deploy.sh propaga"

recusa() { # recusa <rótulo> <args…>
  local rotulo="$1" out rc; shift
  out="$(rodar "$@" 2>&1)"; rc=$?
  ok "$rc" 2 "recusado: $rotulo"
  if [[ -e "$STUB_ARGS" ]]; then echo "FAIL deploy.sh rodou: $rotulo"; FALHAS=1; fi
  contem "$out" "recusado" "mensagem de recusa: $rotulo"
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
contem "$out" "não está na origin/main" "mensagem do commit fora da main"
[[ -e "$STUB_ARGS" ]] && { echo "FAIL deploy.sh rodou com commit fora da main"; FALHAS=1; }

# Destacado: matar o grupo de processos do chamador (como o SSM no timeout/cancel)
# não mata o deploy.sh, que termina e registra o código no log.
rm -f "$STUB_ARGS" "$STUB_ARGS.fim" "$T/logs"/*
(cd / && STUB_DORME=2 exec setsid "$R" "$TAG" "$DA" "$DO") >/dev/null 2>&1 &
chamador=$!
for _ in $(seq 1 50); do [[ -e "$STUB_ARGS" ]] && break; /usr/bin/sleep 0.1; done
kill -KILL -- "-$chamador" 2>/dev/null; wait "$chamador" 2>/dev/null
ok "$([[ -e "$STUB_ARGS.fim" ]] && echo terminou || echo rodando)" rodando "deploy.sh ainda rodando quando o chamador morre"
for _ in $(seq 1 50); do [[ -e "$STUB_ARGS.fim" ]] && break; /usr/bin/sleep 0.1; done
/usr/bin/sleep 0.2
ok "$([[ -e "$STUB_ARGS.fim" ]] && echo terminou || echo morreu)" terminou "deploy.sh termina mesmo com o chamador morto"
contem "$(cat "$T/logs"/deploy-*.log 2>/dev/null)" "deploy.sh saiu com código 0" "log do deploy destacado registra o fim"
exit $FALHAS
