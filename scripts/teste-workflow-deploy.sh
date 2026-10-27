#!/usr/bin/env bash
# Teste dos passos `run:` do job `deploy` de .github/workflows/imagens.yml, fora
# do GitHub: extrai os scripts do YAML (python3 + PyYAML) e roda com um `aws`
# falso. Cobre: configuração ausente (pula com notice + warning, verde), pela
# metade / inválida (falha), sucesso (Pending → InProgress → Success), falhas
# classificadas pelo ResponseCode (1, 2, 10, 11, inesperado; o texto da saída não
# manda), timeout de execução e de entrega, cancelado,
# status desconhecido (prazo esgotado / API falhando: não afirma falha),
# send-command falhando, parâmetros enviados ao SSM.
#
#   bash scripts/teste-workflow-deploy.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! python3 -c 'import yaml' 2>/dev/null; then echo "pulado: python3 sem PyYAML"; exit 0; fi
command -v jq >/dev/null || { echo "pulado: sem jq"; exit 0; }
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
python3 - "$WT/.github/workflows/imagens.yml" "$T" <<'PY'
import sys, yaml
w = yaml.safe_load(open(sys.argv[1]))
passos = {p.get("name"): p for p in w["jobs"]["deploy"]["steps"]}
open(sys.argv[2] + "/config.sh", "w").write(passos["Conferir configuração"]["run"])
open(sys.argv[2] + "/deploy.sh", "w").write(passos["Deploy via SSM"]["run"])
PY
cat > "$T/bin/aws" <<'A'
#!/usr/bin/env bash
echo "aws $*" >> "$FAKE/chamadas"
case "$2" in
  send-command)
    [[ -n "${FAKE_SEND_FALHA:-}" ]] && { echo "AccessDenied" >&2; exit 254; }
    echo "cmd-123" ;;
  get-command-invocation)
    [[ -n "${FAKE_INV_FALHA:-}" ]] && { echo "ThrottlingException" >&2; exit 255; }
    n=$(( $(cat "$FAKE/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE/n"
    IFS=, read -ra seq <<<"$FAKE_STATUS"
    i=$(( n - 1 )); (( i >= ${#seq[@]} )) && i=$(( ${#seq[@]} - 1 ))
    st="${seq[$i]%%/*}"; det="${seq[$i]#*/}"
    [[ "$st" == InvocationDoesNotExist ]] && { echo "InvocationDoesNotExist" >&2; exit 254; }
    jq -n --arg s "$st" --arg d "$det" --argjson c "${FAKE_CODIGO:--1}" --arg o "${FAKE_SAIDA:-}" \
      '{Status: $s, StatusDetails: $d, ResponseCode: $c, StandardOutputContent: $o, StandardErrorContent: ""}' ;;
esac
A
chmod +x "$T/bin/aws"
export PATH="$T/bin:$PATH" FAKE="$T" RUNNER_TEMP="$T" GITHUB_SHA=1a2b3c4d5e6f GITHUB_RUN_ID=99 \
  INTERVALO=0 PRAZO=30 DOCUMENTO=ij-crm-deploy
FALHAS=0
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
contem() { if [[ "$1" == *"$2"* ]]; then echo "ok   $3"; else echo "FAIL $3: sem \"$2\""; FALHAS=1; fi; }
DA="sha256:$(printf 'a%.0s' {1..64})"; DO="sha256:$(printf 'b%.0s' {1..64})"
base_ok() { export TAG=sha-1a2b3c4 DIGEST_APP="$DA" DIGEST_OPS="$DO" \
  ROLE_ARN=arn:aws:iam::123456789012:role/ij-crm-deploy-gha REGIAO=sa-east-1 INSTANCIA=i-0123456789abcdef0; }
# roda <script> → define rc, out (stdout+stderr), sum (resumo), saidas (GITHUB_OUTPUT)
roda() {
  : > "$T/sum"; : > "$T/out"; rm -f "$T/n" "$T/chamadas"
  out="$(GITHUB_STEP_SUMMARY="$T/sum" GITHUB_OUTPUT="$T/out" bash --noprofile --norc -eo pipefail "$T/$1" 2>&1)"; rc=$?
  sum="$(cat "$T/sum")"; saidas="$(cat "$T/out")"
}

# --- Conferir configuração ---
base_ok; ROLE_ARN="" REGIAO="" INSTANCIA="" roda config.sh
ok "$rc" 0 "sem variáveis: passo verde"; ok "$saidas" "pronto=false" "sem variáveis: pronto=false"
contem "$out" "::notice title=Deploy pulado::" "sem variáveis: notice"
contem "$out" "::warning title=Deploy automático NÃO rodou::" "sem variáveis: warning visível"
contem "$sum" "Deploy automático: pulado" "sem variáveis: resumo"
base_ok; INSTANCIA="" roda config.sh
ok "$rc" 1 "variáveis pela metade: falha"; contem "$out" "faltam no environment producao: INSTANCIA" "mensagem das que faltam"
base_ok; INSTANCIA="i-xyz" roda config.sh; ok "$rc" 1 "instância inválida: falha"
base_ok; ROLE_ARN="arn:aws:iam::123:role/x" roda config.sh; ok "$rc" 1 "role inválida: falha"
base_ok; REGIAO="Brazil" roda config.sh; ok "$rc" 1 "região inválida: falha"
base_ok; DIGEST_OPS="" roda config.sh; ok "$rc" 1 "digest ausente do build: falha"
base_ok; TAG="branch-1a2b3c4" roda config.sh; ok "$rc" 1 "tag branch-: falha"
base_ok; roda config.sh; ok "$rc" 0 "configuração completa"; ok "$saidas" "pronto=true" "pronto=true"

# --- Deploy via SSM ---
base_ok
FAKE_STATUS="InvocationDoesNotExist,Pending/Pending,InProgress/InProgress,Success/Success" FAKE_CODIGO=0 \
  FAKE_SAIDA="deploy concluído: sha-1a2b3c4" roda deploy.sh
ok "$rc" 0 "sucesso: job verde"; contem "$sum" "✅ ok: \`sha-1a2b3c4\` no ar" "sucesso: resumo"
contem "$sum" "cmd-123" "resumo com o id do comando SSM"; contem "$sum" "$DA" "resumo com o digest"
contem "$sum" "| Commit | \`1a2b3c4d5e6f\` |" "resumo com o commit"
contem "$out" "deploy concluído" "saída da VPS no log do job"
chamada="$(grep send-command "$T/chamadas")"
contem "$chamada" "--document-name ij-crm-deploy --instance-ids i-0123456789abcdef0" "send-command no documento e instância"
contem "$chamada" "{\"tag\":[\"sha-1a2b3c4\"],\"digestApp\":[\"$DA\"],\"digestOps\":[\"$DO\"]}" "parâmetros: tag + digests"
FAKE_STATUS="InProgress/InProgress,Failed/Failed" FAKE_CODIGO=10 \
  FAKE_SAIDA="deploy-remoto: RESULTADO=10 up/health falhou; rollback automático voltou o app para a versão anterior" roda deploy.sh
ok "$rc" 1 "código 10: job vermelho"; contem "$sum" "rollback automático para a versão anterior ok" "código 10 = rollback automático ok"
contem "$out" "::error title=Deploy sha-1a2b3c4::" "anotação de erro"
contem "$sum" "| Linha da VPS | \`deploy-remoto: RESULTADO=10 " "resumo traz a linha RESULTADO da VPS"
FAKE_STATUS="Failed/Failed" FAKE_CODIGO=11 FAKE_SAIDA="" roda deploy.sh
ok "$rc" 1 "código 11: vermelho"; contem "$sum" "o app NÃO voltou" "código 11 = intervenção manual"
FAKE_STATUS="Failed/Failed" FAKE_CODIGO=2 FAKE_SAIDA="" roda deploy.sh
ok "$rc" 1 "código 2: vermelho"; contem "$sum" "recusado na VPS" "código 2 = recusado"
FAKE_STATUS="Failed/Failed" FAKE_CODIGO=1 FAKE_SAIDA="rollback automático ok: texto que NÃO manda" roda deploy.sh
ok "$rc" 1 "código 1: vermelho"; contem "$sum" "falhou antes de trocar o app" "classifica pelo código, não pelo texto da saída"
FAKE_STATUS="Failed/Failed" FAKE_CODIGO=42 FAKE_SAIDA="" roda deploy.sh
ok "$rc" 1 "código inesperado: vermelho"; contem "$sum" "falhou com código 42" "resumo do código inesperado"
FAKE_STATUS="InProgress/InProgress,TimedOut/ExecutionTimedOut" FAKE_CODIGO=-1 FAKE_SAIDA="" roda deploy.sh
ok "$rc" 1 "timeout de execução: vermelho"; contem "$sum" "estourou o tempo do SSM" "resumo do timeout"
contem "$sum" "verifique o status no SSM" "timeout manda verificar no SSM"
FAKE_STATUS="TimedOut/DeliveryTimedOut" roda deploy.sh
ok "$rc" 1 "não entregue: vermelho"; contem "$sum" "não entregue a tempo" "resumo do não entregue"
FAKE_STATUS="Failed/Undeliverable" FAKE_CODIGO=-1 roda deploy.sh
ok "$rc" 1 "Undeliverable: vermelho"; contem "$sum" "Undeliverable" "resumo do Undeliverable"
FAKE_STATUS="Cancelled/Cancelled" roda deploy.sh
ok "$rc" 1 "cancelado: vermelho"; contem "$sum" "cancelado no SSM" "resumo do cancelado"
PRAZO=0 FAKE_STATUS="InProgress/InProgress" roda deploy.sh
ok "$rc" 1 "prazo esgotado: vermelho"; contem "$sum" "status desconhecido" "prazo esgotado = desconhecido"
contem "$sum" "NÃO quer dizer que falhou" "desconhecido não afirma falha"
FAKE_INV_FALHA=1 FAKE_STATUS="Success/Success" roda deploy.sh
ok "$rc" 1 "API do SSM falhando: vermelho"; contem "$sum" "status desconhecido" "API falhando = desconhecido"
contem "$sum" "verifique o status no SSM (comando cmd-123)" "desconhecido aponta o comando"
FAKE_SEND_FALHA=1 roda deploy.sh
ok "$rc" 1 "send-command falhou: vermelho"; contem "$sum" "não enviado" "resumo do não enviado"
ok "$(grep -c get-command-invocation "$T/chamadas")" 0 "sem envio, nada é consultado"
exit $FALHAS
