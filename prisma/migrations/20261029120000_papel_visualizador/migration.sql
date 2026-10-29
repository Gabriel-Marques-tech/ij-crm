-- Papel somente leitura. Aditiva: valor novo no enum; a versão anterior do app
-- só não conhece usuários com ele (e ninguém o tem até ser convidado/promovido).
ALTER TYPE "Papel" ADD VALUE 'VISUALIZADOR';
