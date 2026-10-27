#!/usr/bin/env bash
# Teste do scripts/checar-migrations.sh num repo git temporário.
#
#   bash scripts/teste-checar-migrations.sh     (sai ≠ 0 se algo falhar)
set -uo pipefail
WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null
G=(git -c user.name=teste -c user.email=teste@exemplo -c init.defaultBranch=main -C "$T")
git init -q "$T"
mkdir -p "$T/prisma/migrations/001_antiga"
# Migration antiga destrutiva: já está na base, não conta.
echo 'ALTER TABLE "a" DROP COLUMN "x";' > "$T/prisma/migrations/001_antiga/migration.sql"
"${G[@]}" add -A; "${G[@]}" commit -qm base
BASE="$("${G[@]}" rev-parse HEAD)"
C="$WT/scripts/checar-migrations.sh"
FALHAS=0
ok() { if [[ "$1" == "$2" ]]; then echo "ok   $3 ($1)"; else echo "FAIL $3: esperado $2, veio $1"; FALHAS=1; fi; }
# caso <rótulo> <rc esperado> <sql>: adiciona uma migration nova, roda e desfaz.
caso() {
  local rotulo="$1" esperado="$2" sql="$3" rc
  mkdir -p "$T/prisma/migrations/999_nova"
  printf '%s\n' "$sql" > "$T/prisma/migrations/999_nova/migration.sql"
  "${G[@]}" add -A; "${G[@]}" commit -qm nova
  (cd "$T" && bash "$C" "$BASE") >/dev/null 2>&1; rc=$?
  ok "$rc" "$esperado" "$rotulo"
  "${G[@]}" reset -q --hard "$BASE"
}
(cd "$T" && bash "$C" "$BASE") >/dev/null 2>&1; ok "$?" 0 "sem migration nova (antiga destrutiva ignorada)"
caso "aditiva (CREATE TABLE / ADD COLUMN / índice)" 0 'CREATE TABLE "b" ("id" TEXT);
ALTER TABLE "a" ADD COLUMN "y" TEXT;
CREATE INDEX "i" ON "a"("y");
DROP INDEX "velho";'
caso "enum: ALTER TYPE … ADD VALUE é aditivo" 0 "ALTER TYPE \"Status\" ADD VALUE 'NOVO';"
caso "DROP TABLE" 1 'DROP TABLE "b";'
caso "drop table minúsculo" 1 'drop table b;'
caso "DROP COLUMN" 1 'ALTER TABLE "a" DROP COLUMN "x";'
caso "DROP COLUMN quebrado em linhas" 1 'ALTER TABLE "a" ADD COLUMN "z" TEXT,
DROP
  COLUMN "x";'
caso "ALTER COLUMN SET DATA TYPE" 1 'ALTER TABLE "a" ALTER COLUMN "x" SET DATA TYPE INTEGER;'
caso "ALTER COLUMN TYPE" 1 'ALTER TABLE a ALTER COLUMN x TYPE bigint USING x::bigint;'
caso "RENAME COLUMN" 1 'ALTER TABLE "a" RENAME COLUMN "x" TO "y";'
caso "RENAME de enum (Prisma)" 1 'ALTER TYPE "Status" RENAME TO "Status_old";'
caso "só em comentário não conta" 0 '-- DROP TABLE "b"; um dia
ALTER TABLE "a" ADD COLUMN "w" TEXT; -- RENAME depois'
caso "-- dentro de string não esconde o DROP" 1 "SELECT '--'; DROP TABLE t;"
caso "/* */ dentro de string não esconde" 1 "SELECT '/*'; DROP TABLE t; SELECT '*/';"
caso "string com '' escapado e -- depois" 1 "SELECT 'it''s --'; ALTER TABLE a DROP COLUMN x;"
caso "comentário de bloco multilinha não conta" 0 '/* DROP TABLE "b";
RENAME */ ALTER TABLE "a" ADD COLUMN "v" TEXT;'
caso "DROP depois de comentário de bloco conta" 1 '/* nota */ DROP TABLE "b";'
caso "destrutiva com marcador" 0 '-- destrutiva-ok: coluna x sem uso desde a release de 2026-10-20
ALTER TABLE "a" DROP COLUMN "x";'
caso "marcador sem motivo não vale" 1 '-- destrutiva-ok:
ALTER TABLE "a" DROP COLUMN "x";'
(cd "$T" && bash "$C") >/dev/null 2>&1; ok "$?" 2 "sem base: erro de uso"
(cd "$T" && bash "$C" deadbeef) >/dev/null 2>&1; ok "$?" 2 "base inexistente: erro"
out="$(cd "$T" && mkdir -p prisma/migrations/998_x && echo 'DROP TABLE "b";' > prisma/migrations/998_x/migration.sql \
  && git -c user.name=t -c user.email=t@e add -A && git -c user.name=t -c user.email=t@e commit -qm x && bash "$C" "$BASE" 2>&1)"
if [[ "$out" == *"::error file=prisma/migrations/998_x/migration.sql::migration destrutiva: DROP TABLE"* ]]; then
  echo "ok   anotação ::error com arquivo e achado"
else
  echo "FAIL anotação: $out"; FALHAS=1
fi
exit $FALHAS
