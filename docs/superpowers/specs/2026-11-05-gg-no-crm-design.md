# Gente & Gestão dentro do CRM: equipe do projeto, fatia A e fase B

Data: 2026-11-05. Status: implementado no PR do kanban interno (#72), para revisão do Gabriel.
Origem: o repositório `automacao-GG` (Next.js + Supabase), migrado aos poucos para o CRM,
reaproveitando as regras dele. Protótipos aprovados pelo Eduardo:
fatia A https://claude.ai/artifact/9fr87MWrr5NaZEacNRrTFx · fase B https://claude.ai/artifact/G8zhGgFCfKJmZxTU317WZf

## 1. Por quê

A mesma pessoa existe duas vezes (membro no G&G, usuário no CRM) e as specs do hub
(§4.5) e do kanban interno (§5) esperavam uma "escala de membros" que não existia:
hoje todo o time de Projetos vê todos os projetos. Este trabalho:

1. cria a **equipe do projeto** (quem trabalha em cada projeto, com função e período);
2. traz a **fatia A** do G&G (membros, organograma, períodos na IJ, importação) e a
   ponte organograma → conta do CRM;
3. traz a **fase B** (demandas Rosa/Azul, agenda e ausências, metas e KPIs, RACI) e as
   pontes com Minha Semana, sino e Kanban.

Fica fora: a fatia C (PDI, padrinhos, notas confidenciais, clima), que tem acesso por
relação entre pessoas e continua no automacao-GG; Google Calendar; e-mail/Slack.

## 2. Equipe do projeto

- `projeto_membro`: pessoa (usuário do CRM), função no projeto (PM, PO, Scrum Master,
  Membro), período `[inicio, fim)`. Sair encerra (fim = hoje), não apaga. Uma vaga
  aberta por pessoa e projeto.
- A função é do projeto, não do organograma: Scrum Master na IJ pode ser só membro num projeto.
- **Quem vê as tarefas do projeto** (`podeVerTarefasDoProjeto`, ponto único em `auth/areas.ts`):
  diretoria (gestor de Projetos ou sem área) e admin sempre; do time de Projetos, quem
  está escalado (equipe aberta, responsável do card ou GP do handoff). **Projeto sem
  equipe fica aberto ao time inteiro**, como era antes.
- **Quem recebe tarefa**: com equipe montada, só quem está escalado. Responsável atual que
  saiu da equipe continua aparecendo para reatribuir.
- **Quem monta a equipe**: diretoria, admin, GP do projeto e responsável do card.
- Aviso no sino `EQUIPE_PROJETO` para quem entra (não para quem se põe).
- Aba **Equipe** no projeto (Visão geral | Tarefas | Equipe), com a carga atual de cada
  pessoa (projetos e tarefas abertas). A aba Tarefas some para quem não está escalado.

## 3. Decisões (as recomendações aceitas pelo Eduardo)

1. Membros e organograma: **todo usuário ativo lê**; editam a área G&G (quem ocupa hoje
   posição em G&G ou nas frentes) e o admin. Vale pelo organograma, não pelo papel do CRM.
2. O organograma **sugere** área e papel no CRM; aplicar é um botão na ficha, só para a gestão
   (mesma regra de Gestão → Usuários: `atualizarUsuario`/`criarConvite`).
3. Pessoa em duas áreas: vale a **ocupação principal**; sem principal entre elas, a ficha avisa.
4. Cargo → papel: **diretoria** (Diretor, Presidente, VP) → GESTOR; liderança e membro →
   papel da área (Projetos → PROJETOS, Vendas → VENDEDOR; outra área → VISUALIZADOR).
   **PM** (cargo marcado `eh_gp`) → GP do lado.
5. Estrutura validada: cada área tem 1 diretor, lideranças (PM, PO, Scrum Master, gerências)
   e membros. Projetos **não tem gerência**. Vendas, Marketing e ADM-FIN: diretor e membros.
   Categoria do cargo (diretoria, liderança, membro) é nova em relação ao G&G.
6. O G&G deixa de editar membros e organograma só depois da migração dos dados reais.
7. Fluxo antigo de demandas (P0–P3, executores) **não migra**; só o registro simples.
8. Registram demanda: área G&G e admin. Assinatura = membro ligado à conta de quem registra.
9. Faltas: a própria pessoa vê as dela; G&G e gestão veem todas.
10. Afastamento planejado com data fica fora: o aviso ao atribuir usa o status "afastado".
11. KPIs medidos pelo CRM: receita fechada no trimestre, entregas no prazo, check-ins vermelhos.
12. Lembrete no sino 2 dias antes: RG para todos; reunião/evento de área para quem é da área
    (ou das frentes dela).

## 4. Modelo (migration `20261105120000_gg_equipe`)

| automacao-GG | CRM | Nota |
|---|---|---|
| membros | `membro` | `usuario_id` opcional e único: conta é outra coisa |
| areas | `area_org` | `Area` já é enum do CRM; ganha `lado_crm` e `eh_gg` |
| cargos | `cargo_org` | `Cargo` já é enum do CRM; ganha `categoria` e `eh_gp` |
| posicoes · ocupacoes | `posicao` · `ocupacao` | `[inicio, fim)`, invalidação com motivo |
| vinculos_institucionais | `vinculo_ij` | reingresso sem sobreposição |
| historico | `historico_org` | escrito pelo serviço na mesma transação |
| importacoes | `importacao_membros` | chave idempotente |
| demandas | `demanda` | só registro simples; limite sob `pg_advisory_xact_lock` |
| eventos_presenca · presencas | `evento_agenda` · `ausencia` | só ausências |
| ciclos · objetivos · resultados_chave · kpis · medicoes_kpi · iniciativas | mesmos nomes | `fonte` = medido pelo CRM |
| papeis/processos/raci | `processo` · `raci` | um A por processo (índice parcial) |
| usuarios (perfil, RLS) | — | o acesso é o do CRM |

Restrições copiadas do G&G em SQL: e-mail único sem caixa, ocupação aberta única por pessoa e
posição, uma principal aberta por pessoa, período aberto único na IJ, um aprovador por processo.
A estrutura inicial (áreas, cargos, posições, sem dados pessoais) entra na própria migration.

## 5. Código reaproveitado

- `automacao-GG/src/lib/modelo.ts` → `src/lib/gg/modelo.ts`: `vigente`, `descendentes`,
  `temCiclo`, `validarImportacao` sem mudança de lógica (mesmas mensagens).
- `ajustar_ocupacao` e `importar_membros` (plpgsql) → `src/lib/gg/organizacao.ts`, em transação,
  com o histórico na mesma transação.
- Trigger `validar_demanda` → `registrarDemanda` com a mesma trava.
- Organograma: desenho do `globals.css .org-*` do G&G (árvore de cima para baixo, cartão com a
  área em cima, liderança em destaque), nos tokens do CRM.
- Cron: `lembrarEventosGG` e `medirIndicadoresDoCrm` no passo de manutenção que já roda a cada 10 min.

## 6. Navegação

G&G é uma área do hub (gaveta da IJ) com menu próprio nas rotas `/gg/*`: Membros,
Organograma, Áreas e cargos, Demandas, Agenda, Metas, Papéis e processos, Importar.
Não é um valor de `Area` (que decide caneta e cards).

## 7. Pendente

- Migração dos dados reais do Supabase e o corte (o automacao-GG passa a ler do CRM).
- O GP do handoff continua um campo próprio; unificar com o PM da equipe fica para depois.
- Fatia C.
