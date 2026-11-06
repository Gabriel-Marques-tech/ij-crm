# Kanban interno do projeto · Etapa 1 — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/projetos/[id]/tarefas` onde o time de projetos cria, edita, exclui e arrasta tarefas de um projeto, num quadro por status separado por responsável, com aviso no sino para quem recebe tarefa.

**Architecture:** Tabela nova `tarefa` ligada a `oportunidade`; serviço puro em `src/lib/tarefas/` com a regra de acesso única `podeVerTarefas`; server actions na própria rota; quadro cliente com `@dnd-kit` no padrão de `kanban/quadro-kanban.tsx`, otimista e re-sincronizado por `revalidatePath`. Nada é gravado na `Timeline` do card.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 6 + PostgreSQL, `@dnd-kit/core` 6.3 (já instalado), zod, Vitest (unit + `*.int.test.ts` em schema isolado).

**Spec:** `docs/superpowers/specs/2026-11-04-kanban-interno-projeto-design.md` (a spec, já no `main`). Esta é a **Etapa 1** da ordem de entrega da spec: modelo, acesso e quadro (status, responsável, prazo, arrastar, separar por pessoa). Prioridade, etiquetas, lista, filtros, atalhos (Etapa 2) e subtarefas, comentários, atividade (Etapa 3) ficam para PRs seguintes; o modelo já nasce com todas as colunas para não migrar duas vezes.

## Global Constraints

- Sem dependência nova: `@dnd-kit` já está no projeto.
- Não mexer em `src/components/shell/rail.tsx` nem em `nav-config.ts` (menu em reestruturação). Acesso só pela página do projeto.
- **Nunca gravar nada na `Timeline` do card** (vazaria para Vendas).
- Toda página e toda server action passam por `podeVerTarefas` (`exigirEscrita` não basta: deixa passar vendedor).
- A action confere que a tarefa pertence ao projeto informado.
- Kanban interno só para card com `pipeline.chave === "projetos"`; em outro quadro o link não aparece e a rota responde 404.
- Identificador `#12` sequencial por projeto, gerado dentro da transação, nunca reaproveitado (soft delete).
- `concluidaEm` preenchido ao entrar em `FEITA`/`CANCELADA` e limpo ao sair. `prazo` é só dia (`@db.Date`); usar `diaEmFuso` (`src/lib/projetos/aging.ts`).
- Excluir é soft delete (`deletadoEm`); apagar o projeto de vez leva as tarefas (`onDelete: Cascade`); excluir a pai leva as subtarefas.
- Aviso no sino via `emitirAvisos` (`src/lib/avisos/avisos.ts`) **depois do commit**; sem aviso para quem atribui a si mesmo.
- Erros: `comTratamento` (`src/lib/erros/registrar.ts`); migration com timestamp real (`20261104…`); commits conventional, PR em português; não commitar `.vitest/json/output.json`.
- Testes de integração rodam no schema isolado (`src/test/db.ts`), nunca no banco `ijcrm`.

## Review Focus

1. Dois cliques rápidos em "criar" no mesmo projeto não podem gerar `#12` duas vezes: teste de concorrência em Task 3.
2. Action chamada com id de tarefa de **outro** projeto (ou tarefa soft-deletada) precisa recusar e não tocar nada: teste em Task 3.
3. Card que saiu de Projetos (voltou para Vendas): a rota responde 404 e as tarefas continuam no banco: teste em Task 3 (serviço) e Task 5 (página).
4. Responsável desativado: o quadro continua carregando com a tarefa na linha dele e dá para reatribuir: teste em Task 3 (`listarQuadro` inclui pessoa inativa como opção marcada).
5. Mover para a mesma coluna/linha (sem mudança) não emite aviso nem muda `concluidaEm`: teste em Task 3.

---

### Task 1: Modelo e migration

**Files:**
- Modify: `prisma/schema.prisma` (enums `StatusTarefa`, `PrioridadeTarefa`; model `Tarefa`; `TipoAviso` ganha `TAREFA_ATRIBUIDA`; relações em `Usuario` e `Projeto`)
- Create: `prisma/migrations/20261104130000_tarefas/migration.sql`

**Interfaces:**
- Produces: `Tarefa` com os campos da spec §3 (`numero`, `paiId`, `titulo`, `descricao`, `status`, `prioridade`, `posicao Float`, `responsavelId?`, `prazo? @db.Date`, `etiquetas String[]`, `concluidaEm?`, `criadoPorId`, `deletadoEm?`), `@@unique([projetoId, numero])`, `@@index([projetoId, status, posicao])`, `@@map("tarefa")`; relações `projeto` (Cascade), `responsavel` (SetNull), `criadoPor`, `pai`/`subtarefas` (Cascade).

- [ ] **Step 1:** Editar o schema conforme a spec §3. Em `Usuario`: `tarefasResponsavel Tarefa[] @relation("tarefaResponsavel")`, `tarefasCriadas Tarefa[] @relation("tarefaCriadaPor")`. Em `Projeto`: `tarefas Tarefa[]`. Em `TipoAviso`: `TAREFA_ATRIBUIDA // alguém te atribuiu uma tarefa do projeto`.
- [ ] **Step 2:** Gerar a migration: `DATABASE_URL=postgresql://ijcrm:ijcrm@localhost:5432/ijcrm pnpm prisma migrate dev --name tarefas --create-only`, renomear a pasta para `20261104130000_tarefas`, conferir o SQL (CREATE TYPE ×2, ALTER TYPE "TipoAviso" ADD VALUE, CREATE TABLE "tarefa", índices, FKs).
- [ ] **Step 3:** `pnpm prisma generate && pnpm typecheck` → sem erros.
- [ ] **Step 4:** Commit `feat(tarefas): modelo Tarefa e aviso TAREFA_ATRIBUIDA`.

### Task 2: Regra de acesso `podeVerTarefas`

**Files:**
- Modify: `src/lib/auth/areas.ts`, `src/lib/auth/areas.test.ts`
- Create: `src/lib/tarefas/acesso.ts`

**Interfaces:**
- Produces: `podeVerTarefas(u: PessoaComLado): boolean` (puro, em `areas.ts`): `u.papel === "ADMIN" || ladoDe(u) === "PROJETOS"`.
- Produces: `exigirTarefas(): Promise<UsuarioSessao>` (`acesso.ts`, `server-only`): `exigirUsuario()` e `redirect("/403")` quando `!podeVerTarefas(u)`. Mesmo padrão de `exigirEscrita`.

- [ ] **Step 1:** Teste em `areas.test.ts`, `describe("podeVerTarefas")`: PROJETOS → true; GESTOR com área PROJETOS → true; ADMIN (sem área) → true; VENDEDOR → false; GESTOR com área VENDAS → false; GESTOR sem área → false; VISUALIZADOR (mesmo com `area: "PROJETOS"` no banco) → false.
- [ ] **Step 2:** `pnpm vitest run src/lib/auth/areas.test.ts` → falha (função não existe).
- [ ] **Step 3:** Implementar as duas funções.
- [ ] **Step 4:** Teste passa. Commit `feat(tarefas): regra de acesso podeVerTarefas`.

### Task 3: Serviço `src/lib/tarefas/tarefas.ts`

**Files:**
- Create: `src/lib/tarefas/tarefas.ts`, `src/lib/tarefas/tarefas.int.test.ts`
- Modify: `src/lib/avisos/regras.ts` (`hrefAviso`: `TAREFA_ATRIBUIDA` → `/projetos/${projetoId}/tarefas`), `src/lib/avisos/regras.test.ts` se existir

**Interfaces:**
- `type Ator = { id: string; nome: string; papel: Papel; area: Area | null; cargos: readonly Cargo[] }` (o `UsuarioSessao` serve).
- `type ErroTarefa = "SEM_PERMISSAO" | "PROJETO_NAO_ENCONTRADO" | "TAREFA_NAO_ENCONTRADA" | "RESPONSAVEL_INVALIDO" | "DADOS_INVALIDOS"`; `type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: ErroTarefa }`.
- `projetoComTarefas(projetoId): Promise<{ id, titulo, pipelineChave } | null>` → null se não existe, deletado ou `pipeline.chave !== "projetos"`.
- `listarQuadro(projetoId, ator): Promise<Resultado<{ projeto; tarefas: TarefaLista[]; pessoas: PessoaTarefa[] }>>` — `TarefaLista = { id, numero, titulo, descricao, status, prioridade, posicao, responsavelId, prazo: string | null (YYYY-MM-DD), etiquetas, paiId, concluidaEm: Date | null, criadoEm: Date }`; `pessoas` = ativos que passam em `podeVerTarefas` + responsáveis inativos de tarefas vivas (`{ id, nome, fotoEm, ativo }`), ordem por nome.
- `criarTarefa(projetoId, dados: { titulo; status?; responsavelId?; prazo?; paiId? }, ator)` → `Resultado<{ id; numero }>`. Título 1–500 chars após trim. `posicao` = max da coluna + 1.
- `editarTarefa(projetoId, tarefaId, patch: Partial<{ titulo; descricao; status; responsavelId; prazo }>, ator)` → `Resultado<{}>`.
- `moverTarefa(projetoId, tarefaId, para: { status; responsavelId?: string | null; posicao: number }, ator)` → `Resultado<{}>`. `responsavelId` ausente = não mexe (quadro agrupado por status).
- `excluirTarefa(projetoId, tarefaId, ator)` → soft delete da tarefa e das subtarefas (mesmo `deletadoEm`).
- Interno: `atribuicaoMudou(antes, depois, ator)` decide o aviso: `depois && depois !== antes && depois !== ator.id` → `emitirAvisos([{ usuarioId: depois, tipo: "TAREFA_ATRIBUIDA", titulo: \`${ator.nome} te atribuiu #${numero} ${titulo} em ${projeto.titulo}\`, projetoId }])`, fora da transação.
- Numeração: dentro de `db.$transaction`, `SELECT id FROM oportunidade WHERE id = $1 FOR UPDATE`, depois `MAX(numero)` (inclusive deletadas) + 1.

- [ ] **Step 1:** Escrever `tarefas.int.test.ts` (`// @vitest-environment node`, `limparBanco(["aviso","tarefa","oportunidade","fase","pipeline","sessao","usuario"])`, semeia pipelines `vendas` e `projetos` com uma fase cada, usuários PROJETOS/GESTOR-projetos/ADMIN/VENDEDOR/GESTOR-vendas/GESTOR-sem-área/VISUALIZADOR, um card em projetos e um em vendas). Casos:
  - `criarTarefa` numera `#1`, `#2`; `Promise.all` de 10 criações → 10 números distintos de 1 a 10; depois de excluir a `#10`, a próxima é `#11`.
  - Cada papel recusado recebe `{ ok: false, erro: "SEM_PERMISSAO" }` em criar/editar/mover/excluir; PROJETOS, GESTOR de projetos e ADMIN passam.
  - Card em vendas → `PROJETO_NAO_ENCONTRADO`; mover o card de projetos para a fase de vendas mantém as linhas em `tarefa` e `listarQuadro` passa a devolver `PROJETO_NAO_ENCONTRADO`.
  - Tarefa de outro projeto (ou deletada) em editar/mover/excluir → `TAREFA_NAO_ENCONTRADA` e nada muda.
  - Nenhuma operação cria linha em `timeline` (`db.timeline.count()` = 0 ao fim).
  - `editarTarefa` status → FEITA preenche `concluidaEm`; voltar para A_FAZER limpa.
  - Atribuir a outra pessoa cria 1 `aviso` TAREFA_ATRIBUIDA para ela com `projetoId`; atribuir a si mesmo não cria; mover sem mudar responsável não cria; responsável VENDEDOR → `RESPONSAVEL_INVALIDO`.
  - Excluir tarefa pai (com 2 subtarefas criadas via `paiId`) marca `deletadoEm` nas 3.
  - Usuário desativado que é responsável: `listarQuadro` devolve a tarefa e a pessoa com `ativo: false`.
- [ ] **Step 2:** `pnpm vitest run src/lib/tarefas` → falha (módulo não existe).
- [ ] **Step 3:** Implementar o serviço e o `hrefAviso`.
- [ ] **Step 4:** Testes passam. Commit `feat(tarefas): serviço de tarefas com numeração por projeto e avisos`.

### Task 4: Server actions

**Files:**
- Create: `src/app/(app)/projetos/[id]/tarefas/actions.ts`, `src/app/(app)/projetos/[id]/tarefas/actions.int.test.ts`

**Interfaces:**
- `type EstadoTarefas = { ok: true; id?: string; numero?: number } | { erro: string } | Inesperado`.
- `criarTarefaAction(projetoId, dados: { titulo: string; status?: StatusTarefa; responsavelId?: string | null; prazo?: string | null })`, `editarTarefaAction(projetoId, tarefaId, patch)`, `moverTarefaAction(projetoId, tarefaId, para: { status: StatusTarefa; responsavelId?: string | null; posicao: number })`, `excluirTarefaAction(projetoId, tarefaId)`.
- Cada uma: `comTratamento("tarefas.<nome>", …)`, `exigirTarefas()`, zod (ids 1–64, título ≤ 500, prazo `YYYY-MM-DD` ou null, posicao finito), serviço, `revalidatePath(\`/projetos/${projetoId}/tarefas\`)`. Mensagens em `MENSAGEM_ERRO_TAREFA: Record<ErroTarefa, string>` (`tarefas.ts`).

- [ ] **Step 1:** Teste com o mesmo mock de `@/lib/auth/atual` do `kanban/actions.int.test.ts` (mas mockando `exigirUsuario` e deixando `exigirTarefas` real importar o mock): VENDEDOR, GESTOR de vendas, GESTOR sem área e VISUALIZADOR → cada action lança `NEXT_REDIRECT` para `/403`; PROJETOS cria (`{ ok: true, numero: 1 }`), edita, move, exclui; dados inválidos → `{ erro: "Dados inválidos." }`.
- [ ] **Step 2:** Falha. **Step 3:** Implementar. **Step 4:** Passa. Commit `feat(tarefas): server actions da página de tarefas`.

### Task 5: Página e quadro

**Files:**
- Create: `src/app/(app)/projetos/[id]/tarefas/page.tsx`, `quadro-tarefas.tsx`, `cartao-tarefa.tsx`, `detalhe-tarefa.tsx`, `tipos.ts`
- Create: `src/lib/tarefas/quadro.ts` + `quadro.test.ts` (puros: `agruparPorResponsavel`, `posicaoEntre`)
- Modify: `src/app/(app)/projetos/[id]/page.tsx` (link "Tarefas do time" na seção Proposta, só se `podeVerTarefas(ator) && card.pipeline.chave === "projetos"`)

**Interfaces:**
- `STATUS_TAREFA: { k: StatusTarefa; nome: string; recolhida: boolean }[]` em `tipos.ts` (Backlog e Cancelada `recolhida: true`), `ROTULO_STATUS`.
- `agruparPorResponsavel(tarefas, pessoas): { chave: string | "none"; nome; tarefas }[]` — pessoas com tarefa primeiro (ordem por nome), "Sem responsável" por último, sempre presente quando tem tarefa.
- `posicaoEntre(antes: number | null, depois: number | null): number` — `(antes + depois) / 2`; só `antes` → `antes + 1`; só `depois` → `depois - 1`; nenhum → `1`.
- Página: `exigirTarefas()`; `listarQuadro`; `PROJETO_NAO_ENCONTRADO` → `notFound()`; `<MarcarQuadroAtivo quadro="projetos" />`; `PageHeader` com eyebrow `projetos · tarefas`, título do card e link de volta; renderiza `<QuadroTarefas projetoId tarefas pessoas meuId hojeDia />`.
- Quadro (cliente): `DndContext` com sensores iguais ao `quadro-kanban`; colunas = `STATUS_TAREFA` (recolhidas viram faixa vertical com contagem, abrem ao clicar ou ao arrastar sobre elas); uma linha por grupo de `agruparPorResponsavel`, linha sem tarefa já nasce recolhida; `useDroppable` por célula `cel:${status}:${grupo}`; `onDragEnd` → otimista + `moverTarefaAction` (status, `responsavelId` quando a linha mudou, `posicaoEntre` dos vizinhos); criação rápida pelo `+` do cabeçalho da coluna (input, Enter cria com `status` e o responsável da linha onde foi aberto); clicar num cartão abre `DetalheTarefa` (Sheet lateral) com título, descrição, status, responsável, prazo (input date) e Excluir (confirm); erro vira `MensagemErro`.
- Cartão: `#numero` e avatar na primeira linha, ícone de status + título, prazo em mono (vermelho se `< hojeDia`, âmbar se `=== hojeDia`), como o protótipo validado.

- [ ] **Step 1:** `quadro.test.ts`: `posicaoEntre` nos 4 casos; `agruparPorResponsavel` põe "Sem responsável" por último e omite pessoa sem tarefa… exceto que a linha de pessoa ativa sem tarefa é devolvida com `tarefas: []` (o quadro mostra recolhida).
- [ ] **Step 2:** Falha. **Step 3:** Implementar helpers, página e componentes. **Step 4:** `pnpm vitest run src/lib/tarefas` passa; `pnpm typecheck && pnpm lint` limpos; abrir `/projetos/<id>/tarefas` com `pnpm dev` e conferir criar, arrastar entre colunas e linhas, editar e excluir.
- [ ] **Step 5:** Commit `feat(tarefas): página /projetos/[id]/tarefas com quadro por responsável`.

### Task 6: PR em draft

- [ ] `pnpm check` verde. Push `feat/tarefas-projeto`; `gh pr create --draft` com título `feat: kanban interno de tarefas do projeto (etapa 1)` e corpo em português: o que entra (Etapa 1), o que fica para as etapas 2 e 3, como testar, decisões do construtor (posição float sem renormalização, aviso só no app).
