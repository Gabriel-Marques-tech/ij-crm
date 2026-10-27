# Calendário, semana em colunas e prazos (GAB-51)

Data: 27/10/2026. Escopo: **etapa 1**, um calendário sobre o que o CRM já tem (próximas ações) mais uma entidade nova, os prazos. A **etapa 2** (Google Calendar, detectar reuniões, agendar) fica fora daqui; a estrutura já está pronta para ela (ver "Etapa 2").

Decisões do usuário estão sem marcação. Escolhas minhas (agente) estão marcadas com **[escolha do agente]**.

## 1. Prazos (entidade nova)

- Tabela `prazo`: `titulo`, `data` (DATE, um dia sem hora), `responsavel_id`, `oportunidade_id` opcional (prazo pode ser de um card ou avulso), `feito_em`/`feito_por_id`, `criado_por_id`, `criado_em`/`atualizado_em` e `deletado_em` (soft-delete, como no resto do app).
- Índices: `(responsavel_id, data)` (semana de uma pessoa), `(data)` (semana do time) e `(oportunidade_id)`.
- Migration `20261027180000_prazos`, só aditiva: tabela nova e `ALTER TYPE "TipoTimeline" ADD VALUE 'PRAZO'`.
- Permissões, conferidas no servidor (`src/lib/prazos/regras.ts` → `podeMexerNoPrazo`, chamada em toda escrita de `src/lib/prazos/prazos.ts`):
  - VENDEDOR cria, edita, conclui e exclui só os prazos em que ele é o responsável;
  - GESTOR/ADMIN fazem isso para qualquer pessoa do time.
  - Na edição, a checagem vale para o responsável atual **e** para o novo, então o vendedor não consegue passar um prazo para outra pessoa. **[escolha do agente]**
- O responsável precisa ser um usuário ativo. Se ele estiver inativo, o prazo pode ser editado mantendo esse responsável. **[escolha do agente]**
- Timeline do card: entrada `PRAZO` quando um prazo do card é criado (`evento: "criado"`) ou concluído (`evento: "concluido"`), na mesma transação. Reabrir não grava entrada, e concluir duas vezes também não. **[escolha do agente]**
- Se o card vai para a lixeira, os prazos dele somem das telas e passam a recusar escrita. Se o card é apagado de vez, os prazos são apagados junto (FK cascade). **[escolha do agente]**
- O card de um prazo não muda pelo editor. Para trocar, exclua o prazo e crie outro. **[escolha do agente]**
- Data no passado é aceita, para registrar um prazo que já passou. **[escolha do agente]**

## 2. Aba Calendário (`/calendario`)

- Item "Calendário" na navegação, logo depois de "Minha Semana", para todos os papéis.
- Segue a estrutura e as medidas do calendário do ICS (`page.tsx`, header, sidebar, legend, week-grid), no visual do CRM (tokens escuros, coral):
  - cabeçalho com o intervalo da semana (em mono), **Meu | Time | Pessoa ▾**, ‹ Hoje › e "+ Prazo";
  - agenda lateral de 220px (`lg:grid-cols-[220px_minmax(0,1fr)]`), agrupada por dia;
  - grade de 7 colunas com largura mínima de 840px e rolagem horizontal no celular;
  - cabeçalho do dia com o dia da semana e o número, e hoje em coral;
  - legenda no pé.
- A semana fica na URL: `?semana=AAAA-MM-DD`. Qualquer dia vale e é normalizado para a segunda daquela semana; valor inválido, ou a mais de 5 anos de distância, cai na semana atual. **[escolha do agente: o limite de 5 anos]**
- A visão também fica na URL: `?ver=time` ou `?pessoa=<id>`. O padrão é "Meu". Pessoa inativa ou inexistente cai em "Meu".
- **Sem régua de horas**: cada célula do dia tem altura mínima de 20rem e guarda as ações em cima, um espaço vazio no meio (clicar cria um prazo naquele dia) e os prazos no pé.
- **A semana começa na segunda (pt-BR).** No ICS ela começa no domingo. **[escolha do agente]**

## 3. Itens

- **Próxima ação → mini-card** (`src/components/calendario/mini-card-acao.tsx`): mostra o texto da ação, a empresa (`nomeExibido`; sem empresa, o título do card), a fase, o avatar do responsável e uma barra à esquerda na cor de "ação". **[escolha do agente: a cor é `chart-4`, o azul da paleta]**
  - Ação vencida (dia antes de hoje): barra e fundo em coral.
  - O card inteiro é um link para o detalhe.
  - Entram só cards abertos (vivos e fora de fase terminal) com a próxima ação dentro da semana, a mesma fonte da Minha Semana.
- **Prazo → "linha de chegada" 🏁** (`linha-chegada.tsx`): o nome fica em cima de uma faixa quadriculada (utilitário CSS `chegada` em `globals.css`, colorido só com tokens).
  - Vencido e não feito: coral.
  - Feito: apagado, riscado e com ✓.
  - Clicar abre um diálogo para editar, concluir/reabrir ou excluir (a exclusão pede um segundo clique de confirmação).
  - Quem não pode mexer vê o prazo só para leitura.
  - Na visão Time, o prazo mostra o avatar do responsável. **[escolha do agente]**
- Ordem dentro do dia: ações por responsável e depois por título; prazos não feitos primeiro e depois por título. **[escolha do agente]**

## 4. Visibilidade

- Todo mundo vê o time inteiro (Time/Pessoa). A visão principal é a da própria pessoa.
- "Pessoa" lista os usuários ativos.
- Cards e prazos de cards na lixeira ficam de fora. Empresa mesclada aparece com o nome da principal.

## 5. Minha Semana: semana em colunas (opção A)

- As listas "Hoje" e "Próximos 7 dias" saíram. No lugar entrou a semana atual (seg–dom) em 7 colunas, com o mesmo `GradeSemana` do Calendário, mostrando as ações e os prazos do vendedor escolhido. No celular, os dias ficam empilhados.
- Continuam funcionando: a saudação, o seletor de vendedor (gestor+), o Top 3 do ranking, a lista "Sem próxima ação" e o "marcar feita".
- Também ficaram, por escolha minha:
  - o **destaque** "mais urgente" no topo **[escolha do agente]**;
  - a lista **"Vencidas antes desta semana"**, porque essas ações não cabem nas colunas e sumiriam **[escolha do agente]**.
- "Marcar feita" nas colunas: o botão ✓ do mini-card abre um diálogo com o mesmo formulário `MarcarFeita`. A coluna é estreita demais para o formulário inline. **[escolha do agente]**
- A Minha Semana mostra só a semana atual, sem navegação. Para outras semanas há o link "abrir no Calendário". **[escolha do agente]**
- O destaque pode repetir uma ação que também aparece numa coluna. Mantive assim de propósito: o destaque é o atalho do "Today". **[escolha do agente]**

## 6. Desempenho

- Só a semana visível. `carregarItensDaSemana` (`src/lib/calendario/calendario.ts`) faz uma query de ações e uma de prazos, em paralelo, com as relações via `select` (sem N+1).
- O dia civil vem de `diaEmFuso` e `inicioDoDia` (America/Sao_Paulo), os mesmos helpers da Minha Semana e do Ranking. O intervalo das ações é meio-aberto: [segunda 00:00 de SP, segunda seguinte).
- `prazo.data` é DATE. O Prisma lê e grava esse valor como meia-noite UTC (`instanteDoPrazo`/`diaDoPrazo`), sem fuso no meio.
- Até 15 usuários: nenhuma dependência nova e nenhuma biblioteca de calendário (só CSS grid).

## Etapa 2 (fora do escopo)

`carregarItensDaSemana` devolve uma lista por tipo de item, e a grade agrupa por dia com `agruparPorDia`. Eventos do Google Calendar entram como uma terceira lista, com o mesmo `dia`, e um card próprio na célula. Se as reuniões tiverem hora, a régua de horas pode voltar só para elas.

## Correção à parte (encontrada no smoke)

O detalhe do card quebrava no `pnpm dev` (o Prisma era empacotado para o navegador). A cadeia era `vinculos-cliente` (cliente) → `vinculo-link` → `lib/entidades/vinculo` → `contatos/match` → `db`.

O problema já existia na `main`. Corrigi movendo `sufixoVinculo` para `lib/entidades/sufixo-vinculo.ts`, que não tem imports. **[escolha do agente]** Pelo mesmo motivo, os rótulos de dia usados no cliente ficam em `lib/calendario/rotulos.ts`, também sem imports.
