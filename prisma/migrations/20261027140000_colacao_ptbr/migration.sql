-- GAB-48: colação ICU pt-BR própria do projeto para ordenar nomes na Tabela
-- (acento e caixa só desempatam). Banco sem ICU falha aqui, no deploy, e não
-- no request. Prod roda postgres:16-alpine (compose.prod.yml), que tem ICU.
CREATE COLLATION IF NOT EXISTS ij_ptbr (provider = icu, locale = 'pt-BR');
