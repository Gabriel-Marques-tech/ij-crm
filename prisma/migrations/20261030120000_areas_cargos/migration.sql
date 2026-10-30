-- GAB-82: lado (área) e cargos do usuário + papel PROJETOS. Aditiva: tipos e
-- colunas novos (nulável / com default); a versão anterior do app ignora as
-- colunas e ninguém tem o papel PROJETOS até ser convidado/promovido.

-- CreateEnum
CREATE TYPE "Area" AS ENUM ('VENDAS', 'PROJETOS');

-- CreateEnum
CREATE TYPE "Cargo" AS ENUM ('GP');

-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'PROJETOS';

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "area" "Area",
ADD COLUMN     "cargos" "Cargo"[] DEFAULT ARRAY[]::"Cargo"[];

-- Backfill: vendedores atuais → lado VENDAS. Gestores/admins/visualizadores
-- ficam sem lado. Idempotente: só toca quem ainda não tem área.
UPDATE "usuario" SET "area" = 'VENDAS' WHERE "papel" = 'VENDEDOR' AND "area" IS NULL;
