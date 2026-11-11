-- Cargos da área de Projetos (PM, PO, Diretor). Só aditiva: ADD VALUE, um por linha,
-- e nenhum dos valores novos é usado nesta migration (Postgres não deixa usar um valor
-- de enum na mesma transação em que ele foi adicionado). Contas com GP em Projetos
-- continuam como estão: o código lê GP em Projetos como sinônimo de PM.
ALTER TYPE "Cargo" ADD VALUE 'PM';
ALTER TYPE "Cargo" ADD VALUE 'PO';
ALTER TYPE "Cargo" ADD VALUE 'DIRETOR';
