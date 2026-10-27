#!/usr/bin/env bash
# Teste do scripts/deploy-remoto.sh (comando forçado do SSH do deploy automático)
# sem SSH nem Docker: o deploy.sh é um stub que grava os argumentos e sai com
# STUB_RC. Cobre: tag válida repassada (único argumento, cwd = raiz), código de
# saída propagado (0, 1, 42), pedidos inválidos recusados com 2 sem rodar o
# deploy.sh (vazio, ausente, latest, rollback, opções, injeção de shell, espaços,
# quebra de linha, maiúsculas, tamanho fora de 7–40).
#
#   bash scripts/teste-deploy-remoto.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/scripts" "$T/bin" "$T/outro"
cp "$WT/scripts/deploy-remoto.sh" "$T/repo/scripts/"
cat > "$T/repo/scripts/deploy.sh" <<'D'
#!/usr/bin/env bash
{ printf 'argc=%s\n' "$#"; printf 'arg=%s\n' "$@"; printf 'cwd=%s\n' "$PWD"; } > "$STUB_ARGS"
echo "saida do deploy.sh"
exit "${STUB_RC:-0}"
D
# logger de mentira: não suja o journal da máquina de quem roda o teste.
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/logger"
chmod +x "$T/repo/scripts/"*.sh "$T/bin/logger"
export PATH="$T/bin:$PATH" STUB_ARGS="$T/args"
R="$T/repo/scripts/deploy-remoto.sh"
FALHAS=0
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }

# Roda como o sshd: SSH_ORIGINAL_COMMAND = o que o cliente pediu, de outro diretório.
rodar() { rm -f "$STUB_ARGS"; (cd "$T/outro" && SSH_ORIGINAL_COMMAND="$1" SSH_CLIENT="203.0.113.9 50000 22" STUB_RC="${2:-0}" "$R") ; }

out="$(rodar sha-1a2b3c4 2>&1)"; rc=$?
ok "$rc" 0 "tag curta válida: sai 0"
ok "$(tr '\n' ' ' < "$STUB_ARGS")" "argc=1 arg=sha-1a2b3c4 cwd=$T/repo " "deploy.sh recebe só a tag, na raiz do repo"
contem "$out" "saida do deploy.sh" "saída do deploy.sh passa para o cliente"
longa="sha-$(printf 'a%.0s' {1..40})"
rodar "$longa" >/dev/null 2>&1; ok "$?" 0 "tag de 40 hex aceita"
ok "$(sed -n 2p "$STUB_ARGS")" "arg=$longa" "tag de 40 hex repassada"
rodar sha-1a2b3c4 1 >/dev/null 2>&1; ok "$?" 1 "falha do deploy.sh (1, ex.: rollback automático) propaga"
rodar sha-1a2b3c4 42 >/dev/null 2>&1; ok "$?" 42 "código arbitrário do deploy.sh propaga"

# Literais de propósito: injeção que NÃO pode expandir.
# shellcheck disable=SC2016
invalidos=(
  ""
  "latest"
  "rollback"
  "rollback sha-1a2b3c4"
  "sha-1a2b3c4 --force"
  "--force"
  "sha-1a2b3c4;rm -rf /"
  ";rm -rf /"
  "sha-1a2b3c4 && id"
  'sha-1a2b3c4$(id)'
  'sha-`id`'
  "sha-1a2b3c4|id"
  " sha-1a2b3c4"
  "sha-1a2b3c4 "
  "sha-1a2b 3c4"
  $'sha-1a2b3c4\nid'
  $'sha-1a2b3c4\n'
  "sha-1A2B3C4"
  "sha-1a2b3c"
  "sha-$(printf 'a%.0s' {1..41})"
  "sha-1a2b3cg"
  "sha-"
  "1a2b3c4"
  "local-1a2b3c4"
  "scp -t /opt/ij-crm"
  "internal-sftp"
  "/bin/bash"
)
for p in "${invalidos[@]}"; do
  out="$(rodar "$p" 2>&1)"; rc=$?
  rotulo="$(printf '%q' "$p")"
  ok "$rc" 2 "recusado: $rotulo"
  if [[ -e "$STUB_ARGS" ]]; then echo "FAIL deploy.sh rodou com $rotulo"; FALHAS=1; fi
  contem "$out" "recusado" "mensagem de recusa: $rotulo"
done
# Sem SSH_ORIGINAL_COMMAND (login interativo / sem comando): recusa.
rm -f "$STUB_ARGS"
out="$(cd "$T/outro" && env -u SSH_ORIGINAL_COMMAND -u SSH_CLIENT "$R" 2>&1)"; rc=$?
ok "$rc" 2 "sem SSH_ORIGINAL_COMMAND: recusado"
[[ -e "$STUB_ARGS" ]] && { echo "FAIL deploy.sh rodou sem SSH_ORIGINAL_COMMAND"; FALHAS=1; }
exit $FALHAS
