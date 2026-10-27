#!/usr/bin/env bash
# Regra expand/contract (README, "Migrations"; runbook §2): migration nova tem de
# rodar com a versão ANTERIOR do app ainda no ar (o rollback não volta o schema).
# Mudança destrutiva vai em duas releases: 1ª para de usar a coluna/tabela, 2ª
# remove — e a 2ª leva o marcador explícito.
#
#   scripts/checar-migrations.sh <base>     (CI: PR → base do PR; push → commit anterior)
#
# Olha só os migration.sql ADICIONADOS entre <base> e HEAD (prisma/migrations/*/).
# Falha se algum tem DROP TABLE, DROP COLUMN, ALTER COLUMN … TYPE ou RENAME
# (ignorando comentários `--`, sem diferenciar maiúsculas, mesmo quebrado em
# várias linhas), a menos que o arquivo tenha uma linha
#   -- destrutiva-ok: <motivo>
# Saída: 0 ok; 1 migration destrutiva sem marcador; 2 uso/base inválida.
set -euo pipefail
export LC_ALL=C

base="${1:-}"
[[ -n "$base" ]] || { echo "uso: $0 <commit base>" >&2; exit 2; }
git rev-parse -q --verify "$base^{commit}" >/dev/null \
  || { echo "checar-migrations: base '$base' não existe neste clone (checkout com fetch-depth: 0?)" >&2; exit 2; }

PADROES=(
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+COLUMN'
  'ALTER[[:space:]]+COLUMN[[:space:]]+("[^"]*"|[^[:space:]]+)[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE'
  'RENAME'
)

erros=0 vistos=0
while IFS= read -r arq; do
  [[ -n "$arq" ]] || continue
  vistos=$((vistos + 1))
  if grep -Eq '^[[:space:]]*--[[:space:]]*destrutiva-ok:[[:space:]]*[^[:space:]]' "$arq"; then
    echo "ok (destrutiva-ok): $arq"
    continue
  fi
  # Sem comentários, tudo numa linha: pega comando quebrado em várias linhas.
  sql="$(sed -E 's/--.*$//' "$arq" | tr '\n\t' '  ')"
  achados=()
  for p in "${PADROES[@]}"; do
    if m="$(grep -Eio "$p" <<<"$sql" | head -n 1)" && [[ -n "$m" ]]; then achados+=("$m"); fi
  done
  if [[ ${#achados[@]} -gt 0 ]]; then
    erros=1
    printf '::error file=%s::migration destrutiva: %s\n' "$arq" "$(IFS='; '; echo "${achados[*]}")"
  else
    echo "ok: $arq"
  fi
done < <(git diff --name-only --diff-filter=A "$base"...HEAD -- 'prisma/migrations/*/migration.sql')

if [[ $erros -ne 0 ]]; then
  cat >&2 <<'MSG'

Migration destrutiva: o app da versão anterior (que segue no ar durante o deploy e
é o alvo do rollback) quebra com ela. Faça em duas releases (expand/contract):
  1. release N: código para de usar a coluna/tabela (ou passa a escrever nas duas);
  2. release N+1: a migration remove/renomeia/troca o tipo, com a linha
       -- destrutiva-ok: <motivo; release N que já parou de usar>
MSG
  exit 1
fi
echo "checar-migrations: $vistos migration(s) nova(s), nenhuma destrutiva sem marcador"
