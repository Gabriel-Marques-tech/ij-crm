# ij-crm — Design

Data: 2026-10-24. Status: aprovado em conversa (brainstorming + grilling); builder check feito, dúvidas resolvidas (§4.3, §4.6, §4.7). Aguardando aprovação final do documento.

## 1. Intenção e porquê

CRM interno da Inteli Júnior (IJ) para o time de vendas. Substitui o Pipefy.

**Problema raiz:** ninguém preenche CRM. O Pipefy exige formulário de 8 campos,
card só nasce na primeira fase, bases de Empresas/Contatos/Atividades ficam
vazias. O fluxo real da IJ é flexível (um lead pode entrar já em "Montando
Proposta"). Resultado: o CRM não reflete a realidade e o time para de usar.

**Solução:** inverter a direção da entrada. O vendedor não abre o CRM para
cadastrar. Ele fala no grupo de WhatsApp do time, como já faz. O sistema
escuta o grupo (Evolution API), decide quais mensagens dizem respeito a uma
venda, extrai os dados com LLM, cria ou atualiza o card e confirma no próprio
grupo. O grupo é a interface de **inserção**; o app web é a interface de
**visualização e gestão**.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos (v1):**
- Kanban por quadro (Vendas e Projetos), card pode nascer em qualquer fase.
- Fases em tabela, editáveis por admin, sem deploy.
- Entidades: Empresa, Contato, Oportunidade (card), Timeline, transição de fase.
- Ingestão de **texto** do grupo WhatsApp via Evolution API: classificação →
  extração → aplicação → confirmação no grupo.
- Três visões: Kanban, Tabela, Minha Semana.
- Login email/senha por convite; papéis admin, gestor e vendedor.
- Importação única do Pipefy (CSV) no go-live.
- Deploy = `docker compose up` numa VPS.

**Não-objetivos (v1, escopados para depois):**
- Áudio (transcrição). O modelo de dados já prevê (`MensagemBruta.mediaType`,
  `mediaUrl`); o pipeline ganha um passo "transcrever" antes da extração.
- Google OAuth (substitui email/senha depois).
- Entidade Projeto com coleta de dados/eficiência; prospecção; email automático;
  métricas/painel (os dados para isso são gravados desde já — ver §5).

**Anti-objetivos (fracasso mesmo funcionando):**
- Exigir campo além de `nome` para criar card.
- Bot que conversa de ida-e-volta no grupo (pergunta, espera resposta, mantém
  sessão). Ele **age e informa**; correção é humana, no app, em 1 arraste.
- Bot que persiste mensagens do grupo não relacionadas a venda.
- Fila, barramento de eventos, Redis, n8n, microsserviços. Público: ≤15 usuários,
  ≤20 acessos simultâneos, poucas escritas concorrentes.
- Duplicar contato por match fuzzy de nome (bug conhecido do LocPay:
  "ELO" casando com "TORRES DE MELO").

## 3. Restrições

- Time pequeno, sem operações dedicadas: 1 repo, 1 container de app, 1 Postgres,
  1 Evolution (com seu próprio Postgres/Redis internos do compose dela).
- VPS ainda não contratada; número de WhatsApp dedicado ainda não comprado.
  Não bloqueiam desenvolvimento (ambiente local com Evolution em compose +
  túnel para webhook), bloqueiam go-live.
- Custo de LLM é irrelevante no volume (~100 msgs/dia → < R$10/mês em qualquer
  modelo cotado). O critério de escolha é acurácia em PT-BR informal, medida.
- Mensagens do grupo contêm dados pessoais de leads (LGPD). Só persistir o que
  foi classificado como relevante; mascarar telefone em logs.

## 4. Decisões de arquitetura (tomadas pelo usuário, salvo onde marcado "minha escolha")

### 4.1 Stack e topologia
- **Next.js full-stack** (App Router, Route Handlers, Server Actions) +
  **Prisma** + **Postgres**. Sem NestJS: a robustez do LocPay vem de 5 serviços
  e SQS; aqui não há isso. Reuso do LocPay é de **padrões**, não de código.
- **Um processo**. Webhook da Evolution é um Route Handler. Jobs leves
  (reprocessar pendentes, aging) via rota `/api/cron/*` protegida por segredo,
  disparada por `cron` do host. Sem fila.
- **Cache** só em memória de processo para config de fases e lista de usuários.
  Sem Redis no app.
- **Lock** para jobs: `pg_try_advisory_lock` (padrão LocPay).
- **Deploy:** VPS Linux, `docker compose` puro, serviços: `app`, `db`
  (Postgres 16), `evolution` (+ seus `evolution-db`/`evolution-redis`),
  `caddy` (HTTPS automático) — minha escolha para o reverse proxy.
- Repo: `ij-crm` (esta pasta), git próprio.

### 4.2 Modelo de domínio
Nomes em português no domínio; colunas/tabelas em `snake_case`.

- **Usuario** `{id, nome, email, senha_hash, papel: ADMIN|GESTOR|VENDEDOR, telefone_whatsapp (normalizado, único, nullable), whatsapp_lid (nullable, único), ativo, convite_token, criado_em}`.
  `telefone_whatsapp` é o que liga remetente do grupo → usuário.
- **Empresa** `{id, nome, cnpj (normalizado, nullable, único quando presente), dominio_email (nullable), cidade, estado, site, observacoes, deletado_em}`.
- **Contato** `{id, nome, empresa_id (nullable), cargo, observacoes, deletado_em}`.
- **ContatoPonto** `{id, contato_id, tipo: TELEFONE|EMAIL, valor_normalizado, valor_original}` — N por contato, **acumulam**, nunca sobrescrevem. Único por `(tipo, valor_normalizado)`.
  Normalização: telefone → E.164 BR (`canonicalizeBrPhone`); email → `toLowerCase().trim()`; CNPJ → remove pontuação + uppercase (formato alfanumérico de 2026), **nunca `\D`**.
- **Pipeline** `{id, chave: 'vendas'|'projetos', nome, ordem}`.
- **Fase** `{id, pipeline_id, chave, nome, ordem, is_terminal, tipo_terminal: GANHO|PERDIDO|null, cor, limite_dias_alerta (nullable)}`. Regras usam `chave`, nunca posição.
- **Oportunidade** `{id, pipeline_id, fase_id, titulo, empresa_id (nullable), contato_id (nullable), responsavel_id, origem: COLD_CALL|RD|INDICACAO|EVENTO|OUTRO|null, dor, orcamento_previsto, proposta_url, valor_fechado, data_ganho, motivo_perda, proxima_acao, proxima_acao_em, revisar (bool), fase_desde, criado_em, criado_via: WHATSAPP|UI|IMPORT, deletado_em}`.
  Oportunidade ganha no pipeline `vendas` cria automaticamente uma Oportunidade no pipeline `projetos` ligada à mesma Empresa/Contato, com `origem_oportunidade_id`.
- **TransicaoFase** `{id, oportunidade_id, de_fase_id (nullable), para_fase_id, usuario_id, origem: WHATSAPP|UI|IMPORT|SISTEMA, em}` — append-only. Base das métricas futuras (tempo por fase, tempo até proposta).
- **Timeline** `{id, oportunidade_id, tipo: CRIACAO|MOVIMENTACAO|CAMPO_ALTERADO|NOTA|MENSAGEM_WHATSAPP|IMPORT, payload jsonb, usuario_id, mensagem_bruta_id (nullable), em}` — append-only.
- **MensagemBruta** `{id, evento_id (= key.id do WhatsApp, único), remetente_telefone, remetente_usuario_id (nullable), grupo_jid, texto, media_type (nullable), media_url (nullable), respondendo_evento_id (nullable), recebida_em, status: RECEBIDA|CLASSIFICADA_IRRELEVANTE|PROCESSADA|FALHA|PENDENTE_REVISAO, resultado_llm jsonb, erro text}`.
  Só persiste quando: tem tag **ou** classificador disse relevante. Irrelevantes não são gravadas; só um contador diário.
- **InboxEvento** `{evento_id pk, recebido_em, status}` — dedup do webhook (Evolution reenvia). Insert + processamento na **mesma transação**: se falhar, rollback remove o inbox row e o reenvio reprocessa (padrão `ConversationIngestService` do LocPay).

Seed de fases (do Pipefy, na ordem):
- `vendas`: primeiro_contato, reuniao_diagnostica, reuniao_intermediaria, montando_proposta, reuniao_proposta, em_negociacao, montando_contrato, contrato_assinado (terminal GANHO), perdido (terminal PERDIDO).
- `projetos`: em_execucao, conclusao, coleta_dados, finalizado (terminal GANHO).

### 4.3 Pipeline de ingestão (workflow, não agente)
```
Evolution webhook (messages.upsert) → POST /api/webhooks/evolution
  1. valida segredo (header apikey/token configurado na Evolution)
  2. ignora: fromMe, grupos ≠ GRUPO_JID, tipos sem texto (v1)
  3. tx: InboxEvento.insertIfNew(key.id) → se existe, 200 e fim
  4. tem tag #crm? → relevante=true, confianca=1
     senão → classificador (LLM barato, saída {relevante, confianca})
            → confianca < limiar → descarta (não persiste), 200
  5. persiste MensagemBruta
  6. monta contexto: remetente→usuário, msg respondida (se houver, busca por
     respondendo_evento_id em MensagemBruta), candidatos de contato
     (match exato por telefone/email extraídos do texto; busca por nome
     top 5 via pg_trgm — só como CANDIDATO, decisão é da LLM + flag),
     lista de fases do pipeline vendas, últimas 5 entradas de Timeline
     dos candidatos
  7. LLM principal, 1 chamada, saída estruturada (JSON schema estrito):
     {intencao: CRIAR|ATUALIZAR|IGNORAR, contato: {id|null, nome, telefone, email},
      empresa: {id|null, nome}, fase_chave|null, campos: {origem, dor,
      orcamento_previsto, cidade, estado, proxima_acao, proxima_acao_em,
      motivo_perda, valor_fechado}, responsavel_nome|null, confianca, resumo}
  8. aplica em 1 tx: cria/atualiza Empresa, Contato, ContatoPonto,
     Oportunidade; move fase (TransicaoFase); grava Timeline; marca
     revisar=true se confianca < limiar OU >1 candidato plausível OU
     fase não inferida em ATUALIZAR
  9. responde no grupo citando a mensagem original:
     "✅ Gustavo Saab (Economia Sensata) → Montando Proposta. Resp: João.
      Próx.: enviar proposta até 28/10" ou "⚠️ Criei em Primeiro Contato,
      marquei para revisar: 2 contatos chamados Gustavo"
  10. falha em 7/8 → MensagemBruta.status=FALHA, erro gravado, resposta no
      grupo "❌ não consegui processar, veja no CRM"; botão Reprocessar na UI
```
- Sem tag e intenção `IGNORAR` → mensagem descartada (apaga MensagemBruta).

**Alvo de `ATUALIZAR` (minha escolha, após builder check):**
- WhatsApp só mexe no pipeline `vendas` na v1. `projetos` é UI.
- Contexto (passo 6) inclui **oportunidades candidatas**: abertas em `vendas`
  dos contatos/empresas candidatos, mais as **últimas 3 oportunidades tocadas
  pelo remetente nos últimos 30 min** (cobre mensagens fragmentadas: "falei
  com o Gustavo" / "é da Economia Sensata" / "mando proposta sexta"). Isso é
  contexto de leitura, não sessão de conversa.
- Saída da LLM ganha `oportunidade_id|null`.
- Regras: 1 aberta → ela. >1 aberta → a tocada mais recentemente + `revisar`.
  Só terminais → cria nova, com `reaberta_de_id` apontando a anterior, +
  `revisar`.
- Confirmações enviadas pelo bot são persistidas em `MensagemEnviada
  {evento_id, oportunidade_id, em}`; reply a uma confirmação resolve o card
  direto, sem LLM decidir.
- Sem nenhum nome (contato nem empresa) e sem candidata recente → **não cria
  card**; grava `PENDENTE_REVISAO` e responde "⚠️ não identifiquei o lead —
  responde esta mensagem com o nome". Não é diálogo: sem estado, se nunca
  responderem fica na fila de pendentes do admin.
- `titulo` = `Contato — Empresa`, ou o que existir. "Nome obrigatório" =
  nome de contato **ou** de empresa.

**Remetente e identidade (minha escolha):**
- Remetente sem `Usuario` ativo → mensagem **ignorada em silêncio**, sem
  persistir conteúdo; contador + telefone/LID aparecem no painel admin em
  "remetentes desconhecidos" com botão "vincular a usuário". Qualquer pessoa
  no grupo **não** consegue mover cards só por estar no grupo.
- Evolution pode entregar `participant` como `xxx@lid` em vez de telefone.
  `Usuario` ganha `whatsapp_lid` (nullable, único). Match: telefone **ou**
  LID. LID é capturado pelo painel acima (admin vincula na primeira vez).
  Construtor deve gravar payload real da instância antes de fechar o parser.

**Aging:** calculado na leitura (`now - fase_desde` vs `limite_dias_alerta`).
Sem cron, sem nudge proativo na v1. O bot **nunca inicia** mensagem; só
responde. Cron fica só para reprocessar `FALHA` e para backup.
- **Safe mode** (padrão LocPay): `NOTIFICATIONS_ENABLED` não setado → envio de
  WhatsApp só loga. Obrigatório em dev. Nunca `true` fora de prod.
- Timeout de envio Evolution: 60s; webhook responde 200 antes de enviar
  confirmação (envio após resposta, em `after()`/background do Route Handler).
- Fase default quando LLM não infere em CRIAR: `primeiro_contato`.
- Responsável: remetente; sobrescrito se LLM extraiu `responsavel_nome` que
  casa com usuário ativo (match exato de nome, sem fuzzy).

### 4.4 LLM
- Camada única `extrairAtualizacao(texto, contexto) → Json` e
  `classificar(texto) → {relevante, confianca}` com provedor por env var.
- **Produção:** OpenAI GPT-6.1 Sol com raciocínio `low` (SDK oficial
  `openai`, Responses API, structured outputs estrito) — escolha do usuário
  (GAB-45). **Alternativa:** Anthropic (Claude Haiku 5.5 / Sonnet 5.5), por
  env (`LLM_PROVEDOR=anthropic`).
- **Benchmark** (parte do plano): ~50 mensagens reais do grupo rotuladas;
  script roda Sonnet 5.5, Haiku 5.5, GPT-5 mini, GPT-5 nano no mesmo
  prompt/schema; mede campos corretos, fase, intenção, latência, custo.
  Escolha final pelo número. Provedor OpenAI entra atrás da mesma interface.
- Classificador local (Laya, sidecar Python) **descartado**: não compensa o
  esforço (mais um serviço e RAM na VPS para ≤ 15 usuários e poucas mensagens
  por dia). `classificar` continua só com o provedor LLM.

### 4.5 App web
- **Kanban** por pipeline: drag-and-drop entre qualquer fase; card mostra
  título, empresa, responsável (avatar), `dias na fase` com cor
  (verde/amarelo/vermelho por `limite_dias_alerta` da fase), badge `revisar`,
  `próxima ação` quando vencida/hoje. Botão "+ card" em qualquer coluna.
- **Tabela**: todas as oportunidades, filtros (pipeline, fase, responsável,
  origem, revisar, período), ordenação, busca; exporta CSV.
- **Minha Semana**: cards do usuário logado com `proxima_acao_em` vencida /
  hoje / próximos 7 dias / sem próxima ação; marca feita → pede próxima.
- **Detalhe do card**: campos editáveis inline, Timeline (inclui texto da
  mensagem WhatsApp original e o JSON da LLM colapsado), notas, mover fase,
  ganho (pede `valor_fechado`) / perdido (pede `motivo_perda`).
- **Empresas / Contatos**: lista + detalhe com oportunidades vinculadas;
  merge manual de contatos duplicados (admin) — merge = soft-pointer
  `merged_into_id`, nunca automático.
- **Gestão** (gestor e admin): fases (CRUD, reordenar, cor, limite de
  dias), usuários (convite por email, telefone WhatsApp, papel, ativar/
  desativar), mensagens com FALHA/PENDENTE_REVISAO com botão reprocessar,
  remetentes desconhecidos, merge de contatos, import Pipefy, restaurar
  cards.
- **Admin** (só admin): tudo do gestor + configuração técnica (grupo JID,
  provedor/modelo LLM, limiares, safe mode), logs de webhook, deleção
  definitiva, promover alguém a admin.

Matriz de papéis:

| Ação | Vendedor | Gestor | Admin |
|---|---|---|---|
| Ver tudo (cards, contatos, empresas, timeline) | ✓ | ✓ | ✓ |
| Criar/editar/mover card, notas, próxima ação | ✓ | ✓ | ✓ |
| Soft-delete de card | ✓ | ✓ | ✓ |
| Restaurar card, merge de contatos | | ✓ | ✓ |
| Fases, usuários (convite, papel ≤ gestor, desativar) | | ✓ | ✓ |
| Reprocessar mensagens, vincular remetente, import | | ✓ | ✓ |
| Config técnica, logs, deleção definitiva, criar admin | | | ✓ |
- Soft-delete de card por qualquer usuário; restaurar: gestor/admin; deleção
  definitiva: só admin.

### 4.5.1 Identidade visual
"Time de vendas se ganha no visual." Referências analisadas:
- **Site da IJ** (intelijunior.com): paleta extraída do CSS — fundo
  `#05060f`, card `#090d1a`, borda `#1c2133`, texto `#f5f6ff`, muted
  `#8d97b4`, **primária coral `#ff4d3a`**, acento laranja `#ff8655`, ring
  `#ff7058`, charts `#ffc857` / `#4cc9f0` / `#8a5cf6`; fonte **JetBrains
  Mono** em tudo; radius `0.625rem`; estética terminal ("[2. Quem somos]",
  "BASE_MEMBROS.exe"). O usuário considera o site feio: **só a paleta é
  herdada**, não a estética.
- **ics-select / Academy Fellow** (github.com/Yuhtin/ics-select, do próprio
  usuário): referência de layout e tom. Superfícies neutras frias claras,
  rail lateral escuro estreito com ícones, uma primária saturada, cores
  semânticas (success/warn/danger/reflect) só em pontos e bordas (nunca
  fundo cheio), Inter para UI, mono para metadados/eyebrows
  (`letter-spacing 0.08em`, caixa alta), números tabulares, muito espaço em
  branco, tela "Today" com o item atual em destaque + resto do dia em lista.
  Tokens em HSL com `<alpha-value>`, dark mode via `data-theme`.

**Direção (decisão do usuário: design do ics-select em modo escuro):**
- Estrutura, componentes e tom do ics-select, **tema escuro como padrão e
  único na v1** (tema claro fica como possibilidade futura, tokens já em
  HSL permitem).
- Tokens de partida = `[data-theme='dark']` do ics-select: bg `240 8% 7%`,
  bg-subtle `240 10% 10%`, surface `240 9% 13%`, surface-strong `240 9% 17%`,
  fg `60 12% 95%`, fg-soft `240 6% 81%`, fg-mute `234 6% 65%`, border
  `234 9% 21%`, border-strong `234 7% 30%`; success `160 70% 48%`, warn
  `32 95% 58%`, danger `0 85% 62%`.
- Primária trocada do azul para o **coral da IJ** `#ff4d3a`
  (≈ `6 100% 61%`), `primary-soft` ≈ `6 60% 20%`, ring/hover `#ff7058`,
  acento `#ff8655` só em detalhes.
- Rail lateral: no escuro vira `bg-subtle` com borda à direita (não há mais
  contraste rail-escuro × página-clara; separação por tom e linha).
- Cards do Kanban: `surface` sobre `bg`, borda `border`, hover
  `surface-hover`; destaque de seleção com `primary-soft`.
- Fontes: **Inter** (UI) + **JetBrains Mono** (eyebrows, datas, contadores,
  IDs, "dias na fase") — o mono carrega a identidade terminal da IJ sem
  virar o site inteiro.
- Semântica de aging: verde/âmbar/vermelho só em dot + borda esquerda do
  card, nunca fundo. Cores de fase: paleta muted por fase, configurável.
- "Minha Semana" segue o padrão "Today": próxima ação vencida em destaque
  grande, resto em lista com hora/dia em mono.
- Tailwind + shadcn/ui (tokens HSL no mesmo esquema do ics-select, sem
  HeroUI). Logo: `/images/logo.svg` do site é PNG embutido — pedir SVG
  vetorial à IJ; até lá usar wordmark em texto.
- Fora de escopo copiar: gradiente prata, beams, animações do site.

### 4.6 Auth e segurança
- Email/senha (argon2), sessão por cookie httpOnly. Gestor/admin convida
  por email (link com token, expira em 7 dias). Sem auto-cadastro. Sem SMTP
  no v1: o link de convite é copiado da tela e enviado pelo próprio gestor
  (minha escolha — tira um provedor de email da infra).
- Rotas: tudo exige sessão exceto webhook e `/api/cron/*` (segredo em header).
- Webhook só aceita `GRUPO_JID` configurado; qualquer outro chat é ignorado
  e nunca logado com conteúdo.
- Logs mascaram telefone. Sem conteúdo de mensagem em log acima de `debug`.
- LGPD: o texto das mensagens `#crm` (só as que chegam à LLM) vai ao
  provedor de LLM nos EUA — OpenAI em produção, como antes ia à Anthropic —
  com `store: false` e sem texto em log. O aviso de privacidade da IJ deve
  citar essa transferência internacional (runbook §10).
- **Retenção (GAB-41, decisão do usuário): 90 dias** para o JSON que a LLM
  devolveu — `mensagem_bruta.resultado_llm` e a chave `saida` do payload das
  entradas `MENSAGEM_WHATSAPP` da Timeline são apagados pelo cron
  (`src/lib/whatsapp/retencao.ts`, em lotes, idempotente). O **texto original**
  da mensagem fica (é o registro da venda). Prévias de import vencidas e sessões
  expiradas também são apagadas pelo mesmo cron.
- **Sem #crm não confirmada (GAB-41, decisão do usuário): 30 dias.** Mensagem
  `sem_tag` que nunca virou venda (`FALHA` ou `PENDENTE_REVISAO`) é apagada
  inteira — linha e texto — depois de 30 dias. As `#crm` mantêm o texto.
- `/api/cron/*`: segredo `CRON_SECRET` forte (mesma regra dos outros segredos,
  tempo constante, falha fechado), uma execução por vez (trava por aluguel de linha, `trava_cron`) e
  resposta só com contagens.
- Google OAuth depois, sem quebrar o modelo (Usuario ganha `google_sub`).

### 4.7 Importação Pipefy
- Script único (`scripts/import-pipefy.ts`) lê CSV exportado, mapeia fases
  por nome → `chave`, cria Empresa/Contato/Oportunidade com
  `criado_via=IMPORT`, Timeline `IMPORT`, `fase_desde = data de entrada na
  fase` se existir no CSV, senão data do import. Idempotente por id do card
  Pipefy (coluna `pipefy_id` em Oportunidade).
- **Escopo:** tudo que o export trouxer, inclusive Finalizado/Perdido
  (volume é pequeno). Se vier histórico de fases, grava `TransicaoFase`
  retroativa; senão só `fase_desde`. Cards em "Contrato assinado" ou além
  geram o card correspondente em `projetos`.
- **Responsável sem usuário cadastrado** → cai no admin que rodou o import,
  com `revisar=true`. Cadastro dos usuários atuais (com telefone WhatsApp)
  é **pré-requisito do go-live**, antes do import.

## 5. O que fica para o construtor
- Esquema exato do JSON de saída da LLM e prompts (mantendo os campos de §4.3).
- Limiares de confiança iniciais (sugestão: classificador 0,7; extração 0,6)
  — ajustar após benchmark.
- Formato exato das mensagens de confirmação (curtas, 1–3 linhas, emoji de
  status no início).
- Estrutura de pastas, nomes de componentes, biblioteca de drag-and-drop.
- Ambiente local: compose com Evolution + túnel (ex.: cloudflared) para o
  webhook, ou simulador de webhook via script que posta payloads gravados.
- Fixtures de payload da Evolution (`messages.upsert`, texto, reply, grupo).
- Estratégia de testes: unitários para normalização/matching/aplicação;
  testes de integração do webhook com Postgres real; LLM mockada por fixtures.
- Caddyfile, Dockerfile multi-stage, `.env.example`, backup diário do Postgres
  (`pg_dump` via cron do host) — recomendado, não opcional.

## 6. Pendências externas (não bloqueiam o plano)
- VPS com SSH; número WhatsApp dedicado; export CSV do Pipefy; ~50 mensagens
  reais para o benchmark; chaves de API (Anthropic; OpenAI se benchmark
  incluir); logo/cores da IJ; lista inicial de usuários e quem é admin.

## 7. Referências
- LocPay `crm-backend` / `app/backend`: `ConversationIngestService`
  (dedup atômico), `pipeline-stage.rules.ts` (regras por chave),
  `CommunicationService.sendWhatsAppMessage` (Evolution, JID de grupo,
  timeout), safe mode `NOTIFICATIONS_ENABLED`, normalização de
  identificadores, proibição de fuzzy para autolink.
