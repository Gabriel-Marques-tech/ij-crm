# ij-crm

CRM interno da Inteli Júnior. Substitui o Pipefy: Kanban de vendas + leads entrando
pelo grupo de WhatsApp (Evolution API + LLM). Design completo em
[`docs/superpowers/specs/2026-10-24-ij-crm-design.md`](docs/superpowers/specs/2026-10-24-ij-crm-design.md).

**Deploy no Coolify:** use [`compose.coolify.yml`](compose.coolify.yml) e o
[guia de configuração](docs/coolify.md). Esse arquivo reutiliza o PostgreSQL
existente e aplica migrations antes de iniciar o app, sem Caddy nem portas
publicadas na VPS. O deploy standalone/AWS com `compose.prod.yml` continua igual.

## Setup (3 comandos)

```bash
cp .env.example .env       # e troque os segredos "troque-me-..." (openssl rand -hex 32)
docker compose up          # Postgres + app com migrations e seed (1ª vez demora: instala deps)
xdg-open http://localhost:3000   # ou abra no navegador
```

## Rodando nativo (mais rápido pra desenvolver)

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm prisma:migrate        # aplica migrations (cria se mudou o schema)
pnpm db:seed               # pipelines e fases do Pipefy
pnpm dev
```

## Worktrees de agentes: FORA do diretório do projeto

O `compose.yml` monta o repo inteiro em `/app` e o `next dev` (Turbopack) varre
tudo o que está lá. Uma worktree dentro do projeto (ex.: `.claude/worktrees/`)
é uma cópia inteira do código: o dev server passa a indexá-la, a CPU/RAM sobe e
os reloads ficam lentos. Crie worktrees ao lado do repo:

```bash
git worktree add ../ij-crm-wt/<nome> -b <branch> origin/main
```

Como rede de segurança, o container de dev esconde `.claude/` (tmpfs) e
`tsconfig`/ESLint ignoram `.claude/`, `.code-review-graph/` e `graphify-out/`.

## Primeiro acesso

```bash
ADMIN_NOME="Seu Nome" ADMIN_EMAIL=voce@ij.com ADMIN_SENHA='min 8 chars' pnpm admin:criar
```

Entre em `/login`. Em **Gestão → Usuários** gere convites: o link é mostrado uma vez,
vale 7 dias, e quem abre define a própria senha. Papéis: `VISUALIZADOR` (só lê), `VENDEDOR` e
`PROJETOS` (operam, cada um no seu lado), `GESTOR` (+ usuários, fases, import), `ADMIN` (+ config
técnica). Sessões vivem no banco (`sessao`): desativar alguém derruba o acesso na hora.

### Papéis, áreas e cargos

Regra pura em `src/lib/auth/papeis.ts` (quem pode o quê) e `src/lib/auth/areas.ts` (de que lado é e
que cargo tem). O **papel** dá permissão; a **área** (`usuario.area`: Vendas ou Projetos) diz por
qual lado a pessoa age na caneta da proposta; o **cargo** (`usuario.cargos`) é um atributo dentro
da área, nunca um papel. Vendedor é sempre de Vendas e Projetos sempre de Projetos; visualizador não
tem lado; gestor e admin só têm lado se a gestão der (ex.: o diretor que também é GP de vendas).

| Área | Cargo | O que muda |
|---|---|---|
| Vendas | **GP** | Age em nome de vendas na caneta: pega a caneta, envia e registra a resposta do cliente sem estar com ela; vê todas as propostas |
| Projetos | **PM** | O "GP do lado" de projetos: pega a caneta, marca a proposta inviável, designa o GP do projeto no handoff; vê todas as propostas |
| Projetos | **PO** | Só o cargo (em geral é quem vira GP do projeto; os POs aparecem primeiro na lista de candidatos). Nenhuma permissão além do papel |
| Projetos | **Diretor** | Só com papel `GESTOR` (ou `ADMIN`) e lado Projetos: é a gestão com lado Projetos, nomeada. Nenhuma permissão nova |

- No convite e na edição, o form oferece só os cargos da área; marcar **Diretor** com papel Projetos
  troca o papel para Gestor na hora (quem não pode atribuir Gestor não vê a opção). O servidor
  (`resolverAreaCargos`) reaplica a regra: cargo de outra área ou Diretor sem gestão é descartado,
  mesmo num FormData forjado.
- **GP em Projetos é legado**: contas anteriores aos cargos de Projetos seguem valendo como PM na
  leitura (`cargosDe`) e viram PM quando reeditadas. O form não oferece GP para Projetos.
- `ehGpDoLado(u, lado)` responde "é o GP deste lado" (GP em Vendas, PM em Projetos): é a função que a
  caneta, o handoff e o MCP consultam. `descreverLado` dá "GP de vendas", "PM, PO de projetos"…
- Novo cargo = `ALTER TYPE "Cargo" ADD VALUE` (aditivo) + entrada em `CARGOS_DA_AREA`.
- A ponte Gente & Gestão → conta (`derivarDoOrganograma`) sugere os cargos pelo organograma: cargo
  com `eh_gp` em área de Projetos → PM, em Vendas → GP; cargo PO → PO; diretoria em área de Projetos
  → Gestor + Diretor.

## Como funciona a conexão com o WhatsApp

Visão geral para quem vai ligar o WhatsApp em produção. Os comandos e detalhes
técnicos estão na seção seguinte e no [runbook §5](docs/runbook.md#5-ler-o-qr-da-evolution-criarreconectar-a-instância).

**A ideia:** a IJ tem um **número dedicado** (chip próprio, não o celular de alguém)
que entra no **grupo de vendas** como um participante comum. O CRM "lê" o grupo
por esse número. Não usa a API oficial do WhatsApp Business: é o mesmo pareamento
do WhatsApp Web ("Dispositivos conectados"), feito pela **Evolution API**, que roda
na nossa própria máquina da AWS.

```
celular do número da IJ ──(QR, uma vez)──► Evolution API (na VPS, sem porta pública)
                                                │  cada mensagem nova do grupo
                                                ▼
                         webhook interno ──► app ij-crm ──► LLM ──► card no Kanban
                                                │
                     confirmação no grupo ◄─────┘ (só com NOTIFICATIONS_ENABLED=true)
```

1. **Pareamento (uma vez, só ADMIN):** em **Gestão → Admin → "Mostrar QR"**, escaneie com o
   celular do número: WhatsApp → Dispositivos conectados → Conectar dispositivo.
   A sessão fica salva na Evolution; o celular pode ficar guardado, mas precisa
   abrir o WhatsApp de vez em quando (o WhatsApp derruba aparelhos conectados se o
   principal ficar ~14 dias sem internet).
2. **Grupo:** adicione o número ao grupo de vendas. Em **Gestão → Admin → "Listar
   grupos"**, escolha o grupo e salve. O CRM só olha esse grupo; o resto é ignorado.
3. **Quem é quem:** o CRM reconhece o remetente pelo telefone cadastrado em
   **Gestão → Usuários** (ou em **Meu perfil**), ou pelo LID vinculado em
   **Gestão → WhatsApp → "Vincular a usuário"** (o WhatsApp às vezes manda um id
   interno no lugar do telefone). Mensagem de remetente não reconhecido é contada
   e descartada, sem guardar o texto.
4. **Webhook:** a Evolution avisa o app a cada mensagem nova, por rede interna do
   Docker e com segredo (`scripts/evolution.sh webhook`, uma vez, na VPS).
5. **O que acontece com cada mensagem:**
   - com `#crm` → a LLM cria ou atualiza o card ([#crm → card](#crm--card-llm));
   - sem `#crm` → um classificador decide se é registro de venda. Se achar que
     não é, ou tiver baixa confiança, a mensagem é descartada sem guardar o texto.
     Se for, segue o mesmo fluxo com régua mais alta; venda com extração incerta
     vai para a fila de revisão em **Gestão → WhatsApp**, sem responder no grupo
     ([Mensagens sem #crm](#mensagens-sem-crm-classificador-gab-39));
   - figurinha, emoji solto ou remetente não cadastrado → descartada, sem LLM.
6. **Resposta no grupo:** o bot só escreve no grupo (confirmação do card) com
   `NOTIFICATIONS_ENABLED=true`. Sem isso é o **safe mode**: lê, processa e cria
   cards, mas fica calado (aparece só no log). Ligar por último, depois de testar.

**Sem o número ainda?** O CRM funciona inteiro sem WhatsApp: Kanban, cards,
prazos, Calendário, Minha Semana, Contatos, Empresas, Tabela, Ranking e Gestão.
O time lança e atualiza os cards à mão. Quando o número chegar, são só os passos
1 a 4 e o 6 acima (confira os telefones do time em Gestão → Usuários); nada precisa
ser refeito. Para testar antes, dá para parear um número pessoal/chip de teste no
ambiente de dev (safe mode, nada é enviado), seguindo a seção abaixo: lá o webhook
usa a URL da tabela `WEBHOOK_URL` conforme o app roda em Docker ou `pnpm dev`
(`scripts/evolution.sh` aponta fixo para `http://app:3000`, o caso da VPS).

**Trocar de número** depois: `scripts/evolution.sh logout` + parear o novo
([runbook §4](docs/runbook.md#4-trocar-o-número-do-bot)). O CRM guarda o grupo,
não o número, então os cards e o histórico continuam.

**Privacidade (LGPD):** a partir do webhook, o texto das mensagens do grupo vai
para o provedor de LLM, mesmo em safe mode. Publique o aviso de privacidade da IJ
**antes** de ligar o webhook ([runbook §10](docs/runbook.md#10-provedor-de-llm-e-crédito-da-openai--gemini)).

## WhatsApp (Evolution API)

A Evolution API v2 (`evolution` + `evolution-db` + `evolution-redis`, em `127.0.0.1:8080`)
fica no perfil `whatsapp` do compose — sem ele, `docker compose up -d db` segue funcionando.
Antes, gere os dois segredos no `.env` (`openssl rand -hex 32`): `EVOLUTION_API_KEY` e
`EVOLUTION_WEBHOOK_SECRET`. **O app rejeita segredo com menos de 32 caracteres ou que comece
com `troque-me`** — com segredo fraco o webhook responde 401 e nada é enviado.

```bash
docker compose --profile whatsapp up -d          # ou: up -d evolution
source .env   # para usar $EVOLUTION_API_KEY e $EVOLUTION_WEBHOOK_SECRET abaixo

# 1. Criar a instância (nome = EVOLUTION_INSTANCE). `token` = EVOLUTION_API_KEY de propósito:
#    é o valor que a Evolution põe no campo `apikey` do corpo de cada webhook (fallback de auth).
curl -s -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d "{\"instanceName\":\"ij-crm\",\"token\":\"$EVOLUTION_API_KEY\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}"

# 2. Ler o QR (base64 em `.base64`; ou abra http://localhost:8080/manager e use a apikey)
curl -s http://localhost:8080/instance/connect/ij-crm -H "apikey: $EVOLUTION_API_KEY" | jq -r .base64
# Escaneie no celular da IJ: WhatsApp → Dispositivos conectados → Conectar dispositivo.

# 3. Apontar o webhook messages.upsert da instância para o app, com o header de segredo
curl -s -X POST http://localhost:8080/webhook/set/ij-crm \
  -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d "{\"webhook\":{\"enabled\":true,\"url\":\"$WEBHOOK_URL\",\"byEvents\":false,\"base64\":false,
       \"headers\":{\"x-webhook-secret\":\"$EVOLUTION_WEBHOOK_SECRET\"},\"events\":[\"MESSAGES_UPSERT\"]}}"

# 4. Descobrir o JID do grupo de vendas → GRUPO_JID no .env (termina em @g.us)
curl -s 'http://localhost:8080/group/fetchAllGroups/ij-crm?getParticipants=false' \
  -H "apikey: $EVOLUTION_API_KEY" | jq -r '.[] | "\(.id)\t\(.subject)"'
```

`WEBHOOK_URL` depende de onde o app roda:

| app rodando em | `WEBHOOK_URL` |
|---|---|
| `docker compose up` (serviço `app`) | `http://app:3000/api/webhooks/evolution` |
| `pnpm dev` nativo no host | `http://host.docker.internal:3000/api/webhooks/evolution` |
| Evolution em outra máquina/VPS apontando para o seu `pnpm dev` | túnel: `cloudflared tunnel --url http://localhost:3000` → `https://<aleatorio>.trycloudflare.com/api/webhooks/evolution` |

Segurança do webhook — duas formas, comparação em tempo constante:

1. **Preferida:** header `x-webhook-secret` (ou `apikey`) igual a `EVOLUTION_WEBHOOK_SECRET`.
   A Evolution **não** manda a apikey como header; o header vem de `webhook.headers` (passo 3).
2. **Fallback** (até validar o item 1 numa instância real): campo `apikey` do **corpo** igual a
   `EVOLUTION_API_KEY`. Só funciona porque a instância foi criada com `token = EVOLUTION_API_KEY`
   e o compose mantém `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true`.

Segredo ausente/fraco ⇒ aquela forma não existe; sem nenhuma ⇒ 401 para tudo. `GRUPO_JID`
vazio ⇒ 503. Re-tentativas: o compose configura a Evolution v2.3.7 para 5 tentativas com
backoff exponencial (5s → 120s) em 5xx/timeout e **nenhuma** em 400/401/403/404/422 — o app
devolve 4xx só para erro definitivo e 500 quando vale re-tentar (o dedup é atômico).
Em dev, `NOTIFICATIONS_ENABLED` fica ausente: a confirmação do bot só aparece no
log como `[SAFE MODE] WhatsApp NÃO enviado para 12****01@g.us`.

A Evolution não guarda mensagens, contatos nem chats no banco dela (`DATABASE_SAVE_DATA_*=false`
— design §2); a confirmação cita a mensagem original mandando `quoted.key` **e** `quoted.message`.

Nesta fatia (GAB-28) o bot só reage a mensagens com `#crm` de usuários ativos com
`telefoneWhatsapp`/`whatsappLid` cadastrado; o resto é contado (`contador_descartadas`,
`remetente_desconhecido`) e descartado sem persistir conteúdo. O que acontece com a mensagem
`#crm` está em [#crm → card](#crm--card-llm); sem tag, em [Mensagens sem #crm](#mensagens-sem-crm-classificador-gab-39).

## #crm → card (LLM)

Fluxo (GAB-34, design §4.3 passos 6–10): o webhook comita a `MensagemBruta` como `RECEBIDA`,
responde 200 e agenda `processarMensagem(id)` (`src/lib/whatsapp/processar.ts`) em `after()`.

1. **Reivindica** a linha: `UPDATE … SET status='PROCESSANDO', tentativas=tentativas+1 WHERE id=$1 AND
   status='RECEBIDA' RETURNING tentativas`. Retry da Evolution ou chamada concorrente não acha a linha →
   no-op; a LLM nunca é cobrada duas vezes. A tentativa `n` devolvida é a **cerca**: a transação de
   aplicação (e o registro de `FALHA`) começa com `UPDATE … WHERE status='PROCESSANDO' AND tentativas=n`;
   0 linhas → outro worker reivindicou depois, este desiste sem gravar nem responder.
2. **Contexto** (fora de transação): remetente, mensagem respondida, fases de Vendas, candidatos por
   telefone/email/CNPJ **exatos** citados no texto (`identificadores.ts`).
3. **LLM** (fora de transação — a tx do Prisma expira em 5s): `extrairAtualizacao` (`src/lib/llm/`),
   prompt + JSON schema versionados em `prompts/extracao.v1.ts`, saída validada por zod.
   Valores ("uns 15k") e datas ("sexta", relativas à mensagem, fuso de SP) são convertidos por código
   (`valores.ts`, `datas.ts`), não pela LLM.
4. **Aplica** numa transação (`aplicar.ts`): cria/reaproveita Empresa/Contato/pontos, cria o card
   (fase pela chave ou `primeiro_contato`; terminal recusada), TransicaoFase, Timeline
   `MENSAGEM_WHATSAPP` (texto + JSON da LLM, recolhido no card) e grava `resultado_llm`.
5. **Responde** citando a mensagem (texto da LLM achatado numa linha e cortado em ~80 caracteres):
   `✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)`;
   `⚠️ …` + "Marquei para revisar: …" quando `revisar`; `⚠️` para pendências; `❌ não consegui
   processar, veja no CRM (ref: …)` em falha (`grep 'ref=…'` no log). Mensagem que tinha dado ❌ e
   foi reprocessada recebe uma 2ª resposta começando com `✅ Reprocessada: …`.

Regras: o contato é decidido pelos telefones/emails **achados no texto** (não pelo que a LLM ecoa):
um dono vivo → reaproveita (e a empresa dele, resolvendo merge; nome lido diferente → `revisar`), donos
diferentes → `PENDENTE_REVISAO`; vínculo automático de empresa **só por CNPJ**; domínio de email e nome igual são sugestão
(`revisar` + `resultado_llm.aplicacao.sugestoes`); ponto de contato de contato excluído → `PENDENTE_REVISAO`;
sem nome de contato nem de empresa → não cria, `PENDENTE_REVISAO`; `ATUALIZAR` → seção abaixo; `IGNORAR` →
`PENDENTE_REVISAO`; responsável = remetente, trocado só por nome
completo exato de usuário ativo; `revisar` se confiança < `LLM_LIMIAR_CONFIANCA` (0.7).
Status: `RECEBIDA → PROCESSANDO → PROCESSADA | PENDENTE_REVISAO | FALHA`. `processarMensagem` nunca
lança (roda no `after()`): erro de banco vira log com ref e a linha fica para o reprocessamento.

**Contrato do reprocessamento (GAB-41)** — devolve a `RECEBIDA` e chama `processarMensagem`:
- `RECEBIDA` há mais de N min (o processo morreu antes do `after()`; o retry da Evolution cai em
  `DUPLICADO` e não reprocessa);
- `PROCESSANDO` há **mais de 5 min** (`atualizado_em`; pior caso LLM 2×30 s + transação) — nunca antes,
  ou dois workers pagam a LLM (a cerca impede só a gravação dupla);
- `FALHA` (inclusive "sem crédito na API de LLM/da OpenAI/da Anthropic", depois da recarga), **mantendo `erro`**.

Env: `LLM_PROVEDOR=openai|anthropic|mock` (padrão `openai`; ver "Provedor de LLM" abaixo; dev sem chave: `mock`, que responde com as fixtures de
`src/lib/llm/fixtures/extracao.ts`), `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (a do provedor escolhido;
vazia → `FALHA` com motivo "SEM_CHAVE", nada quebra), `LLM_EXTRACAO_MODELO` (vazio = padrão do
provedor: `gpt-6.1-sol`, GPT-6.1 Sol com raciocínio low; `claude-haiku-5-5` na Anthropic),
`LLM_LIMIAR_CONFIANCA`. Saldo esgotado → `FALHA` com "sem crédito na API da OpenAI" (ou "da
Anthropic") + ref, reprocessável (GAB-41) depois da recarga. Cada chamada loga provedor, modelo, versão, ms e tokens — nunca o texto:
`[llm] extracao ref=<id> provedor=openai modelo=gpt-6.1-sol versao=extracao.v1 ms=… tokens_in=… tokens_out=… tokens_reasoning=… ok`.

## Provedor de LLM (OpenAI padrão, Anthropic e Gemini alternativas)

`src/lib/llm/provedores/`: `openai.ts` (padrão do código, GAB-45), `anthropic.ts`, `gemini.ts` e `mock.ts`,
todos atrás de `ProvedorLlm` (`tipos.ts`); `comum.ts` tem a política comum (timeout 30 s, SDK
com `maxRetries: 0`, 2ª tentativa só em 5xx/timeout/rede).

- **OpenAI**: SDK oficial `openai`, Responses API, modelo `gpt-6.1-sol` (GPT-6.1 Sol, id conferido
  no `ChatModel` do SDK) com `reasoning: { effort: "low" }` explícito, `store: false`, saída em
  `text.format` `json_schema` `strict: true` com o mesmo `JSON_SCHEMA_EXTRACAO` (o zod valida
  depois). Não manda `temperature`/`top_p`. `status: incomplete` (`max_output_tokens`) →
  `TRUNCADA`; recusa/`content_filter` → `RECUSA`; texto não-JSON → `SEM_JSON`; todos `FALHA` com ref.
- **Sem crédito**: códigos de saldo/limite de gasto documentados (`insufficient_quota`,
  `credit_balance_exhausted`, `*_spend_limit_exceeded`, `*usage_limit_exceeded`, `billing_not_active`)
  no `code`/`type` do erro (nunca na mensagem) → `SEM_CREDITO`, "sem crédito na API da OpenAI". A
  mensagem da API não é logada. `status: failed` → `FALHA_PROVEDOR` com o código (`server_error` e
  `rate_limit_exceeded` re-tentam uma vez).
- **Gemini** (`LLM_PROVEDOR=gemini`): SDK oficial `@google/genai` (Gemini Developer API, chave do
  Google AI Studio em `GEMINI_API_KEY`), modelo `gemini-3.8-flash` (Gemini 3.8 Flash; id conferido no
  union `Model` do SDK e na lista oficial de modelos). `thinkingConfig` só para quem pensa:
  `gemini-3*` → `thinkingLevel: LOW`, `gemini-2.5-*` → `thinkingBudget: 1024`, `gemini-2.0-*`/aliases →
  nenhum. `responseMimeType: application/json` + `responseJsonSchema` com o mesmo schema dos outros,
  filtrado por `paraSchemaGemini` (anulável continua `anyOf: [T, null]`; palavras-chave fora do subconjunto
  caem; snapshot no teste). Retentativa do SDK desligada explicitamente (`retryOptions: { attempts: 1 }`).
  `promptFeedback.blockReason` e finish de segurança (`SAFETY`, `RECITATION`, `SPII`...) → `RECUSA`;
  `MAX_TOKENS` → `TRUNCADA`; outro finish → `FALHA_PROVEDOR`. **Sem crédito**: HTTP 402 (pré-pago
  esgotado) ou `ErrorInfo.reason` de billing (`BILLING_DISABLED`...) → `SEM_CREDITO`, "sem crédito na API
  do Gemini". **Cota diária**: 429 `RESOURCE_EXHAUSTED` com `QuotaFailure` de `quotaId` diário →
  `COTA_DIARIA` (reprocessada sempre, como sem crédito, e com alerta de ops próprio); 429 por minuto é
  rate limit comum (`HTTP 429`). Só `status`/`details` do corpo, nunca a `message`. `tokens_out` =
  `candidatesTokenCount + thoughtsTokenCount`.
- **Smoke** (`pnpm llm:smoke`, `scripts/smoke-llm.ts`): uma chamada real por schema (extração,
  classificação, resumo) ao provedor do env, com mensagem sintética; imprime só status/tokens/ms e sai ≠ 0
  se falhar. Em produção: `dc --profile ops run --rm llm-smoke` (runbook §10).
- **Deploy**: `scripts/deploy.sh` recusa o deploy se o provedor selecionado não tem chave
  (`scripts/_llm.sh`).
- Trocar: `LLM_PROVEDOR=openai|anthropic|gemini` + a chave (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/
  `GEMINI_API_KEY`), no `.env` ou em Admin → Configuração (provedor/modelo; a chave fica só no env, e o
  Admin mostra "configurada/ausente"). `LLM_EXTRACAO_MODELO` vazio = padrão do provedor
  (`gpt-6.1-sol`/`claude-haiku-5-5`/`gemini-3.8-flash`); modelo de outro provedor (prefixo, sem
  `models/` e em minúsculas: `claude-`, `gemini-`, OpenAI `gpt-`/`o<n>`/`chatgpt-`/`codex-`/`ft:`;
  prefixo desconhecido como `gemma-*` não é de ninguém) → `FALHA` "PROVEDOR_INVALIDO". `mock` é recusado em produção. Passo a
  passo: `docs/runbook.md` §10.
- Log por chamada: `[llm] extracao ref=<id> provedor=openai modelo=gpt-6.1-sol versao=extracao.v1
  ms=… tokens_in=… tokens_out=… tokens_reasoning=… ok` (`tokens_out` já inclui os de raciocínio).
- Crédito pré-pago com recarga manual (auto-reload desligado, mínimo US$ 5, expira em 1 ano,
  sugestão US$ 50 a cada ~3 meses): `docs/runbook.md` §10.

## Mensagens sem #crm (classificador, GAB-39)

Mensagem do grupo **sem** `#crm` de vendedor cadastrado (design §4.3 passo 4, §2):

1. **Ingestão** (tx do dedup): ruído óbvio — nenhuma letra nem dígito (só emoji/figurinha/símbolo;
   `ruido.ts`) — ou remetente desconhecido → só `contador_descartadas.total` do dia; nada de LLM.
   Mensagem curta com letra ("fechou!", "perdeu") vai ao classificador. Senão o `InboxEvento` fica
   `PROCESSADO`, o webhook responde `200 {emAvaliacao: true}` e agenda `avaliarSemTagComLimite`
   (`src/lib/whatsapp/sem-tag.ts`) em `after()`: no máximo **3 classificações simultâneas** por
   processo e **50 na fila** em memória; além disso → não classificada (`FILA_CHEIA`). Retry da
   Evolution → `DUPLICADO`.
2. **Classificador** (`src/lib/llm/classificacao.ts`, prompt `prompts/classificacao.v1.ts`): mesmo
   provedor/modelo da extração (GPT-6.1 Sol, raciocínio low; `LLM_CLASSIFICACAO_MODELO` opcional,
   ignorado com aviso se for de outro provedor), prompt curto, contexto = só a mensagem respondida (300
   caracteres), saída `{relevante, confianca}` em JSON schema estrito, teto de 2000 tokens de saída
   (o raciocínio conta contra ele; `TRUNCADA` ganha 1 nova tentativa). Log: `[llm] classificacao
   ref=<evento> … tokens_reasoning=… max_out=2000 relevante=… confianca=…` — nunca o texto.
   Delimitadores (`<mensagem>`, `<respondendo_a>`, inclusive `</ mensagem >`) dentro do texto são
   neutralizados (`prompts/escapar.ts`).
3. `relevante=false` ou `confianca < LLM_LIMIAR_CLASSIFICADOR` (0.7) → **descartada**: nenhuma
   `MensagemBruta`, só `contador_descartadas.total` +1 (dia civil de SP, só data + número).
4. Relevante → grava `MensagemBruta` com `sem_tag = true` e segue o fluxo de [#crm → card](#crm--card-llm);
   a extração recebe o aviso "mensagem sem #crm… responda IGNORAR se não for registro de venda". Régua
   mais alta (`regra-sem-tag.ts`). **Pendente sem tag é silencioso**: nenhuma resposta no grupo, só a fila
   de revisão (painel do GAB-41); mensagens com `#crm` continuam recebendo o ⚠️ de sempre.
   - confiança da extração `< LLM_LIMIAR_SEM_TAG` (0.85; nunca abaixo de `LLM_LIMIAR_CONFIANCA`) →
     `PENDENTE_REVISAO` (`SEM_TAG_INCERTO`);
   - `IGNORAR` confiante → a linha é apagada e conta como descartada (`IGNORAR` incerto cai na regra acima);
   - `CRIAR` sem telefone/email/CNPJ citado no texto → `PENDENTE_REVISAO` (`SEM_TAG_SEM_IDENTIFICADOR`; defesa contra injeção: uma
     mensagem que convença a LLM não cria card sozinha); `ATUALIZAR` — e reply a uma confirmação do bot,
     que o GAB-38 fixa no card dela — segue as regras de alvo de [ATUALIZAR](#crm--atualizar-card-existente-llm-atualizar);
   - se agir (criar ou atualizar), a confirmação troca o ✅/⚠️ por
     `↪️ entendi como atualização: Gustavo — Economia Sensata → Primeiro Contato. Resp: João.`
   - a extração usa o prompt em vigor (`extracao.v3`), com o mesmo escape de delimitadores e a linha de "sem #crm".

**Falha na classificação** (sem crédito, provedor fora, saída inválida, `TRUNCADA` 2×, erro de banco
ou inesperado, fila cheia): o texto **não** é gravado (guardar "por via das dúvidas" seria guardar
conversa do grupo). Em troca: `contador_descartadas.nao_classificadas` +1, log `[sem-tag] ref=…`
com o erro saneado (`erro-seguro.ts`; nunca o texto) e alerta de ops se for `SEM_CREDITO` (GAB-46, que
avisa que mensagens sem #crm não são reprocessadas). **Nada vai para o grupo** — nem aviso, nem citação
da mensagem. Limitação aceita: se o processo morrer
entre o 200 e o fim do `after()`, a mensagem sem tag se perde (não há cópia para retomar).

Limiares (`LLM_LIMIAR_CONFIANCA`, `LLM_LIMIAR_CLASSIFICADOR`, `LLM_LIMIAR_SEM_TAG`) fora de 0–1 ou
ilegíveis viram o padrão com um `[config] …` no log (uma vez, já no boot via `src/instrumentation.ts`).
Saem do env quando a config do admin (GAB-42) existir.

Fixtures: `src/lib/llm/fixtures/classificacao.ts` (10 de venda + 10 de conversa do grupo); o `mock`
responde por elas (texto desconhecido → não relevante).

## #crm → atualizar card existente (LLM ATUALIZAR)

GAB-38, design §4.3 "Alvo de ATUALIZAR". Prompt `extracao.v2` (mesmas chaves da v1; muda o texto e o
contexto). Só o pipeline **Vendas**; `projetos` é UI.

- **Candidatas** no contexto (`candidatas.ts`, só leitura): cards de Vendas dos contatos/empresas casados
  por identificador exato (CNPJ; domínio só como sugestão) + os **3 últimos projetos que o remetente
  tocou** (Timeline com o usuário dele) nos 30 min antes da mensagem — cobre mensagens picadas
  ("falei com o Gustavo" / "é da Economia Sensata" / "mando proposta sexta").
- **Alvo** (`alvo.ts`, puro): reply a uma confirmação do bot → o card dela (`MensagemEnviada.oportunidade_id`,
  gravada a cada confirmação), **sem a LLM decidir** (vale mesmo se ela disser CRIAR) — só se a confirmação
  tem até 30 dias e o card está vivo em Vendas; senão `PENDENTE_REVISAO` (nunca vira CRIAR). Senão o
  `oportunidade_id` da LLM, **só se estiver na lista enviada**; escolha só pela conversa recente (sem
  identificador exato) vale sem `revisar` só se for o ÚNICO card que o remetente tocou nos 30 min (aberto,
  sem card aberto por identidade concorrendo); qualquer outra ambiguidade → `revisar`; card fechado com um aberto da mesma identidade → o aberto. Senão, entre as candidatas por identidade:
  1 aberta → ela; >1 → a tocada mais recentemente + `revisar`; só fechadas → card **novo** com
  `reaberta_de_id` + `revisar`. Nenhum → `PENDENTE_REVISAO` ("não achei o card para atualizar").
- **Aplicação** (`atualizar.ts`, mesma transação/cerca do CRIAR): aplica só campos presentes (nunca
  apaga; origem só se vazia), pontos de contato citados no texto acumulam no contato do card (de outro
  contato → `revisar`, nunca rouba; sem contato onde guardar → `revisar`), empresa por CNPJ só em card sem
  empresa, nome comparado **exato** (nunca por trecho); card com empresa de outro nome só troca numa
  **correção por reply**, sempre com `revisar`; contato que já tem empresa nunca é reescrito; dono do card
  nunca muda pelo WhatsApp ("responsável sugerido" + `revisar`); título automático acompanha os vínculos. Fase pela chave
  via `registrarMovimento` (TransicaoFase `WHATSAPP`, Timeline, locks por `travarPipelines` — ganho trava
  também `projetos`; os campos entram antes do movimento, então o card de projeto já nasce com eles).
  **Terminal** só com o dado **ancorado no texto**: ganho precisa de um valor escrito na mensagem igual ao
  que a LLM leu ("18 mil"), perda de um sinal de perda ("perdemos", "desistiu", "não fechou"… ou o
  motivo escrito); sem isso não move e marca `revisar`.
- **Confirmação** cita o card: `✅ Gustavo — Economia Sensata: Primeiro Contato → Reunião Diagnóstica.
  Próx.: reunião (30/10)`; sem movimento `✅ Título (Fase): atualizado.`; `⚠️` + motivo quando `revisar`.

## Contexto de 12 h da LLM (ledger + resumo, GAB-49)

Mensagens picadas ("falei com o Gustavo" … 2 h depois … "mando proposta sexta") ganham contexto real.
Janelas **fixas de 12 h** em America/Sao_Paulo: 00:00–12:00 e 12:00–24:00 (`src/lib/contexto/janela.ts`).

- **Ledger** (`contexto/ledger.ts`): as mensagens de venda do remetente na janela atual, antes desta —
  derivado de `mensagem_bruta` (remetente + `recebida_em`), **sem tabela nova**. Entra: com `#crm`, sempre
  (não aplicada aparece com a situação: "pendente de revisão", "falhou", "em processamento"); sem tag, **só
  `PROCESSADA`**. Fica fora: sem tag em qualquer outro status, `CLASSIFICADA_IRRELEVANTE`, e o que nunca foi
  gravado ou foi apagado. Cada linha leva o card que ela mexeu (Timeline). No prompt (`extracao.v2.1`, seção
  `<historico>`): orçamento de 3000 caracteres (400 por mensagem), as mais recentes primeiro, exibidas em
  ordem cronológica (até 60 linhas lidas).
- **Candidatas**: os cards que as mensagens do ledger mexeram na janela (consulta própria, não o ledger
  cortado; até 5) entram com `via: ledger`. Escolhido só pelo ledger (mexido há mais de 30 min) → aplica com
  `revisar`; o ✅ do "único card recente" (GAB-38) continua valendo só se o remetente não mexeu em **outro**
  card na janela. Card **fechado** que só veio pelo ledger nunca é reaberto → `PENDENTE_REVISAO`
  ("não reabri").
- **Nada copiado do histórico**: orçamento e data da próxima ação só entram se estiverem escritos na
  mensagem atual (dinheiro pelo mesmo parser do ganho; data pela expressão escrita); senão o campo cai e o
  card fica `revisar`. Texto livre (próxima ação, dor) entra normalmente.
- **Resumo da janela anterior** (`contexto/resumo.ts`, prompt `resumo.v1`, seção `<resumo_anterior>`, até
  1200 caracteres). **Fora do caminho da mensagem**: a extração só lê o resumo PRONTO; ausente ou
  `GERANDO` → segue sem ele. Faltando, `processarMensagem` dispara a geração em paralelo (sem esperar) e
  só aguarda no fim, ainda no `after()` — a 1ª mensagem da janela sai sem resumo, as seguintes com.
  - **Uma vez** por vendedor e janela: chave única `resumo_janela(usuario_id, janela_inicio)` +
    reivindicação; quem perde a corrida desiste na hora. Até 3 tentativas por janela (FALHA ou `GERANDO`
    abandonado há > 5 min).
  - Só gera com a fotografia completa: se a janela anterior ainda tem mensagem do vendedor `RECEBIDA` ou
    `PROCESSANDO`, fica para o próximo gatilho.
  - Falha → `FALHA` com código + ref; nunca bloqueia nem lança.
  - LGPD: o prompt proíbe telefone, email, endereço, dados bancários e documentos; o código remove os
    formatos de telefone/CPF/CNPJ/email (datas, horas e valores ficam).
  - Mensagem reprocessada de outra janela não gera resumo.
- **Retenção**: só o resumo da janela anterior à atual fica; os mais antigos são apagados no começo de cada
  geração (índice de `janela_inicio`).
- **Para o cron (GAB-41)**: `gerarResumosPendentes(agora, { prazoMs })` gera os da janela anterior de todos
  os vendedores (índice `mensagem_bruta(recebida_em)`), com prazo total de 2 min (para entre um vendedor e
  outro, pelo menos um por rodada; devolve `{ gerados, interrompido }`), e aplica a retenção;
  `aplicarRetencaoResumos()` só a retenção. Nunca lançam.
- Log por chamada, sem texto: `[llm] resumo ref=<id do resumo> provedor=… modelo=… versao=resumo.v1 ms=…
  tokens_in=… tokens_out=… ok chars=…` + linha em `log_llm` (`operacao=resumo`).

## Avaliação do contato e sentimento do lead (GAB-85)

"Os leads gostaram do contato?" (spec fase 2 §4.14, Q23). Dois sinais, ambos em **colunas** da Timeline
(fora do `payload`), prontos para o painel (GAB-94):

- **Nota do vendedor** (`timeline.nota`, 1–5, CHECK no banco): opcional, um clique nas estrelas ao
  registrar uma nota no detalhe do Projeto ou ao "Marcar feita" na Minha Semana. Clicar de novo limpa.
- **Sentimento do lead** (`timeline.sentimento` e `mensagem_bruta.sentimento`: `POSITIVO`/`NEUTRO`/
  `NEGATIVO`): a LLM lê na **mesma chamada** da extração (prompt `extracao.v3` = v2.1 + uma regra; schema
  + `sentimento`). No parse é tolerante: ausente ou fora do enum vira `null`, nunca `SAIDA_INVALIDA`.
  "Resolver manualmente" copia o da mensagem para a Timeline.
- **Retenção**: a purga de 90 dias apaga `resultado_llm` e `payload.saida`; as colunas ficam.
- Detalhe do Projeto: cada entrada mostra a nota (★ 4/5) ou o sentimento ("Lead: positivo"); o topo da
  Timeline resume a média e as contagens. Agregado por vendedor/período:
  `avaliacoesPorVendedor({ de, ate })` (`src/lib/projetos/avaliacao-consulta.ts`; vendedor = remetente da
  mensagem `#crm`, senão o autor da entrada).

## Alerta de sem crédito na LLM

GAB-46. A recarga da API de LLM é manual (pré-pago). Quando uma chamada falha com `SEM_CREDITO`
(qualquer provedor), o caminho de `FALHA` de `processar.ts` chama `alertarSeSemCredito`
(`src/lib/llm/alerta-credito.ts`), que:

- manda `⚠️ Sem crédito na API de LLM. Mensagens do grupo estão ficando em FALHA e serão reprocessadas
  depois da recarga. Mensagens sem #crm não são reprocessadas; quem precisar, reenvie com #crm. ref: …` para `ALERTA_OPS_JID` pelo `enviarWhatsApp` de sempre (timeout 60 s);
- respeita cooldown guardado no banco (`alerta_operacional`, sobrevive a restart): 6 h depois de um aviso
  entregue, 5 min se o envio falhou (ou se o processo cair entre reivindicar e enviar). Entrega confirmada
  pela Evolution conta como avisado mesmo se a gravação local falhar depois (`ErroPosEnvio` em `enviar.ts`);
- com `NOTIFICATIONS_ENABLED`≠`true` ou `ALERTA_OPS_JID` vazio, só loga (`[alerta-credito] … ref=…`);
- nunca lança e nunca leva texto de mensagem do grupo (só a ref; `grep 'ref=…'` acha a causa).

Gestor/admin veem um banner no topo do app ("desde …" e "Último erro de crédito: …") enquanto o incidente
estiver aberto. Ele **não expira por tempo**: sem uma chamada bem-sucedida não dá para saber se o saldo voltou.
A primeira chamada à LLM que der certo (`marcarCreditoOk`) fecha o incidente e apaga o banner, mas **não**
zera o cooldown: o limite de 1 aviso a cada 6 h vale mesmo com falhas e sucessos alternados. Depois da
recarga, as mensagens em `FALHA` voltam pelo reprocessamento (GAB-41).

## Avisos: sino no app + WhatsApp privado (GAB-88)

Camada única em `src/lib/avisos/avisos.ts` (`emitirAvisos`): toda origem de aviso passa por ela
(caneta, comentários, envio, handoff e o lembrete de check-in).

- **Sino** (topo do app): contador + lista, marcar um ou todos como lidos. Atualiza por polling
  (`GET /api/avisos`, só a contagem, a cada 30 s e pausado com a aba oculta); aberto, carrega a lista.
- **WhatsApp privado** só para "é sua vez" e "proposta aceita / handoff" (`vaiPorWhatsapp` em
  `src/lib/avisos/regras.ts`). O resultado fica em `aviso.whatsapp`: `DESLIGADO` (a pessoa desligou em
  Meu perfil › Avisos no WhatsApp), `SEM_TELEFONE` (só no app, sem erro), `SAFE_MODE`
  (`NOTIFICATIONS_ENABLED`≠`true`: o log `[avisos] ref=… SAFE MODE` diz o que seria enviado),
  `PENDENTE` → `ENVIADO`/`FALHOU`. O envio real roda em segundo plano (quem agiu não espera a
  Evolution); falha nunca desfaz a ação, vira `[avisos.whatsapp] ref=…` no log e a mesma ref aparece no
  item do sino. `PENDENTE` com mais de 5 min (o processo caiu no meio do envio) vira `FALHOU` com ref
  quando o sino lista. O envio privado não é vinculado ao card (`mensagem_enviada.projeto_id` nulo).
- **Caneta** (`src/lib/avisos/caneta.ts`, ouvinte de `propostas/avisos.ts`): quem recebe a caneta
  (passar, devolver, concordar) → "é sua vez"; GP pegou a caneta → quem estava com ela, só no app;
  mudança de status → no app para quem já atuou na proposta (menos quem agiu).
- **MCP**: `listar_avisos` e `marcar_avisos_lidos` (sempre os da própria pessoa, qualquer papel).
  `marcar_avisos_lidos` não anuncia `readOnlyHint` (campo `muda` da ferramenta), mas não é escrita no CRM.

## Proposta como folha (GAB-100)

Spec: `docs/superpowers/specs/2026-11-04-proposta-folha-design.md`. A tela tem três colunas: comentários
na margem, folha no centro, ações e cartões à direita (`grade-folha.tsx`). Abaixo de 1024 px, comentários e
infos abrem em painel.

- **Modelo**: `src/lib/pdf/templates/ij.ts` no PDF e `.folha` em `globals.css` na tela, com as mesmas
  proporções, Arimo e Poppins. As imagens ficam em `src/lib/pdf/imagens` (PDF) e `public/images/proposta` (tela).
  Sem marca de "fim da página" na folha: o cálculo do gerador não vale para a largura da tela. "Ver PDF"
  (`?rascunho=1`) mostra o rascunho em qualquer status; o PDF de envio continua sendo o da versão final.
- **Blocos móveis**: `blocoDados` é só o lugar de Cronograma e Investimento; os dados ficam no `estruturado`, e o
  cálculo do que aparece é um só (`blocos-dados.ts`). No Markdown, uma linha sozinha `<!-- bloco:cronograma -->` ou
  `<!-- bloco:investimento -->`. Os dois no fim, nessa ordem, são a posição padrão e não se escrevem: proposta antiga
  continua com o mesmo Markdown. `<!-- bloco:nenhum -->` registra que os dois saíram da folha. Na âncora
  de comentário, o bloco entra por um caractere reservado (`TOKEN_BLOCO`), nunca pelos dados nem pelo título; o MCP
  comenta o bloco citando o título. O diff compara a forma de exibição, com os blocos explícitos.
- **Tabela livre** (GAB-102): nó `table` em `documento.ts`, só no nível de cima, sempre retangular, com a primeira linha de
  cabeçalho, um parágrafo por célula (texto, negrito, itálico) e sem mesclar. Limites em `tabela.ts`: 100 linhas (com o
  cabeçalho), 8 colunas e 1000 caracteres por célula. No Markdown é a tabela GFM padrão, com `| --- |` em cada coluna e
  `<!-- total -->` no começo da 1ª célula da linha de total. **Total é só uma marca de quem escreve**: muda fundo e negrito, e
  nada soma nem confere. Pipe na célula sai `\|`; `<br>` vira espaço; linha irregular alarga a tabela ou completa com vazias,
  sem perder texto; `:---:` perde o alinhamento (o modelo é um só: 1ª coluna à esquerda, demais ao centro). Além dos limites, o
  MCP recebe erro (`TABELA_GRANDE`), o editor recusa a edição com aviso, e a canonização (OCR) deixa como parágrafos `a | b`.
  Documento antigo não muda: `a | b` em parágrafo continua texto. No PDF, a tabela quebra entre páginas repetindo o
  cabeçalho, sem partir linha; só a linha maior que uma página inteira parte, para não sair texto da folha. A largura das
  colunas é a mesma conta na folha e no PDF (`largurasDaTabela`). Em tela estreita, a tabela rola por dentro, e nunca a
  página. Teclado: Tab anda entre células, Alt+F10 vai para os controles, Esc volta; Alt+Shift+setas, Alt+Shift+Backspace e
  Delete, Alt+Shift+T. Na âncora de comentário, cada célula não vazia é um bloco do texto plano. No diff, uma linha por
  linha da tabela, sem a régua, e `[linha de total]` no lugar da marca.
- **Totais**: a tabela só mostra total de valor com parcela em todas as entregas e soma igual ao valor, e total de
  duração só com duração em todas as entregas e sem contradizer o prazo. O que não fecha vira aviso no cartão, sem travar.
- **Duração**: a entrega tem `dia` ou `duracao` ("2 semanas"), nunca as duas. `dia` é `null` na que só tem duração;
  a cópia para a execução (`execucao-entrada.ts`) calcula a data prevista com `datasPrevistas` (`estruturado.ts`): durações
  em sequência a partir da entrada em Execução, e entrega com data vira o novo ponto de partida.
- **Cartão "Dados da proposta"**: grava sozinho pela mesma `revisao` do texto. Dado incompleto não vai
  ao servidor: fica no cartão com o motivo, e segura passar a caneta. Ao sair da tela, grava o que está válido, sem nunca
  apagar entrega gravada: com uma linha já gravada incompleta, o cronograma salvo fica inteiro; só linha marcada como nova é descartada.

## Comentários na proposta (GAB-91)

Serviço em `src/lib/propostas/comentarios.ts` (tela e MCP chamam as mesmas funções), tabela
`proposta_comentario`.

- **Quem**: quem vê a proposta (ver "Visibilidade por área") e está **ativo**, em qualquer etapa, sem a caneta. VISUALIZADOR não comenta.
  Comentar não edita o texto. Geral ou preso a um trecho; respostas em thread (um nível); resolver e
  reabrir (estado na raiz + evento `comentario_resolvido`/`comentario_reaberto` na Timeline).
- **Âncora do trecho** (`src/lib/propostas/ancora.ts`): o trecho citado + até 40 caracteres de contexto
  de cada lado, no "texto plano" do documento (blocos de texto não vazios separados por `\n`, igual no
  editor, na leitura e no servidor). Para achar: todas as ocorrências do trecho; vence a de contexto mais
  parecido. Não achou → "trecho alterado" (o comentário continua visível). O texto plano é sempre o
  canônico: o editor ao vivo normaliza cada bloco como o Markdown (espaços repetidos, tab, pontas) com um
  mapa para a posição crua, e o servidor normaliza o trecho recebido da tela e do MCP. Não é marca no documento: o
  destaque é decoração do ProseMirror no editor (`components/propostas/destaques-editor.ts`) e `<mark>`
  na leitura — o Markdown e a validação do subconjunto não mudam. Preso à proposta, não à versão.
- **Ao vivo**: polling de `GET /api/projetos/[id]/comentarios?v=<versão>` a cada 5 s, pausado com a aba
  oculta; com a versão igual o servidor responde só `{ versao }` (contagem + último `atualizado_em`).
- **Aviso**: `COMENTARIO`, só no app, para o dono da caneta (nunca para quem comentou). Pendente não avisa.
- **Limites**: 2000 caracteres por comentário e 500 no trecho (CHECK no banco também); texto puro.
- **MCP**: `listar_comentarios_proposta`, `comentar_proposta` (geral, `trecho` = texto exato do
  rascunho atual, ou `campo`), `responder_comentario_proposta`, `resolver_comentario_proposta`,
  `reabrir_comentario_proposta`, `sugerir_texto_proposta`, `adicionar_a_revisao_proposta`,
  `enviar_revisao_proposta`, `descartar_da_revisao_proposta`. Mesma permissão da tela (`escrita: false`,
  `muda: true` nas que gravam).
- **Revisão (GAB-101)**:
  - **Sugestão aplicável** (`sugestao`, `src/lib/propostas/sugestao-trecho.ts`): texto novo de um trecho
    de um mesmo bloco, mostrado como diff no cartão. Só quem tem a caneta aplica, pela fila do autosave e
    pelo núcleo de `salvarRascunho` (lock, caneta, `revisao`, conflito); a mesma transação resolve a conversa e
    registra quem aplicou (`sugestao_aplicada` na Timeline). Aplicar é mais exigente que destacar: a
    ocorrência precisa ter intacto ao menos um lado do contexto **dentro do próprio bloco** (o contexto da
    âncora atravessa o `\n`; no "+" da linha ele mora todo nos vizinhos, e editar os vizinhos não muda o
    trecho). O contexto inteiro só desempata entre ocorrências iguais; empate é ambíguo → desatualizada.
    Texto novo herda a formatação do começo do trecho. Reabrir a conversa não desfaz o texto.
  - **Lote** (`pendente`): "Adicionar à revisão" fica só para o autor, em tudo (lista, carimbo do polling,
    MCP, id), e não conta como aberto. "Enviar revisão (N)" publica e gera um único aviso.
  - **Campo** (`campo`): valor, prazo, escopo e entregas aceitam comentário, sem sugestão, assim como os
    blocos Cronograma e Investimento.
  - **Por id**: inexistente, sem acesso e pendente de outra pessoa dão a mesma resposta ("não encontrado").

## Painel de mensagens e cron (GAB-41)

**Gestão → WhatsApp** (`/gestao/whatsapp`, gestor/admin; vendedor → 403). Serviço em
`src/lib/whatsapp/painel.ts`; 5 consultas por página, fila paginada (20), sem N+1.

- **Fila**: `FALHA` e `PENDENTE_REVISAO` com texto, remetente, motivo (`erro` com ref, ou
  `resultado_llm.aplicacao.motivo`) e o JSON da LLM recolhido. Detalhe técnico (tokens, webhook):
  Admin → Logs (GAB-42); a ref do motivo é a mesma do log do servidor.
- **Reprocessar**: `reprocessarMensagem` (`reprocessar.ts`) — devolve a `RECEBIDA` **mantendo `erro`** e
  chama `processarMensagem` (mesma reivindicação com cerca). É a mesma função do cron: dois cliques,
  clique + cron, nunca dois cards. `PROCESSADA` nunca volta.
- **Resolver manualmente**: cria card (título sugerido do texto, fase aberta de Vendas, responsável =
  quem mandou) ou liga a um card existente de Vendas (busca por título); Timeline `MENSAGEM_WHATSAPP` com o texto e
  autor = quem resolveu; mensagem `PROCESSADA` com `resolvida_por_id`/`resolvida_em`. Trava a linha da
  mensagem antes (`FOR UPDATE`). Nada vai para o grupo.
- **Remetentes desconhecidos**: telefone/LID **mascarado**, total e última vez, nunca conteúdo.
  "Vincular a usuário" grava `telefone_whatsapp` (telefone) ou `whatsapp_lid` (LID) e apaga a linha;
  recusa se o usuário já tem outro valor (troca é em Usuários) ou se for gestor mexendo em admin. Atômico:
  o UPDATE confere no `where` o telefone/LID/papel/ativo lidos; mudou no meio → "mudou enquanto você vinculava".
- **Descartadas por dia** (14 dias): `contador_descartadas.total` e `nao_classificadas` (GAB-39).
- **Últimas 50 processadas**, cada uma com link para o card (via Timeline).

Reprocessar uma `FALHA` que falha de novo **não** manda outro ❌ no grupo (já mandou na 1ª). Mensagem
**sem #crm** nunca recebe ❌ (nem na 1ª falha, nem reprocessada pelo painel ou pelo cron).

**Cron** — `POST /api/cron/reprocessar` (`src/app/api/cron/reprocessar/route.ts`), a cada 10 min por
`scripts/cron-reprocessar.sh` (runbook §7). `x-cron-secret` = `CRON_SECRET` (≥ 32 chars, sem
`troque-me`, tempo constante; fraco/ausente ⇒ 401 para tudo). Uma execução por vez
(trava por aluguel de linha em `trava_cron`, 9 min, sem segurar conexão; ocupada ⇒ `200 {emAndamento:true}`;
processo que morre libera quando o aluguel vence). Resposta só com contagens.
Passos (`src/lib/cron/manutencao.ts`, cada um isolado, erro ⇒ ref + HTTP 500):

1. **Retenção LGPD, 90 dias** (`retencao.ts`): apaga `mensagem_bruta.resultado_llm` e a chave `saida`
   das Timeline `MENSAGEM_WHATSAPP`; o texto original fica. Lotes de 500, idempotente (índice parcial
   em `recebida_em` das linhas com JSON).
   **Sem #crm não confirmada, 30 dias**: `sem_tag` em `FALHA`/`PENDENTE_REVISAO` com mais de 30 dias é
   apagada inteira (linha e texto) — conversa do grupo que ninguém validou como venda.
2. Prévias de import vencidas (`purgarVencidas`, GAB-37) e sessões expiradas.
3. Contexto de 12 h (GAB-49): `aplicarRetencaoResumos()` (apaga resumos de janelas antigas) e
   `gerarResumosPendentes(agora, { prazoMs: 60 s })` (resumo da janela fechada de cada vendedor), cada um
   isolado, só contagens (`resumosApagados`, `resumos.gerados`). Rodam antes do reprocessamento.
   Lembrete de check-in (GAB-95, `lembrarCheckinsAtrasados`, contagem em `lembretesCheckin`): ver Execução, em Kanban.
4. **Reprocessamento** (`retomarPendentes`), no máximo 20 por execução, mais antigas primeiro, nada novo
   depois de 4 min contados do início da execução: `RECEBIDA` parada > 2 min (órfã); `PROCESSANDO` > 5 min volta a `RECEBIDA` (nunca
   antes); travada/órfã que já tem 3+ tentativas vai para `FALHA` `TENTATIVAS_ESGOTADAS ref=…` (sem laço); `FALHA` com < 3 tentativas; `FALHA` por sem crédito (`aplicacao.codigo = LLM_SEM_CREDITO`)
   sempre — mas a execução **para no 1º sem crédito de novo** (1 chamada por execução enquanto não
   recarregar). Banco/config fora (`ERRO`) também interrompe e a ref entra em `erros` (HTTP 500).

## Kanban

`/kanban` (Vendas; `?quadro=projetos` para Projetos) e detalhe em `/projetos/[id]` (links antigos `/kanban/:id` e `/oportunidades/:id` redirecionam, ver `src/lib/rotas/antigas.ts`). Serviço em
`src/lib/projetos/`: criar/mover tomam o lock de pipeline (`travarPipelines`, ordem por id;
ganho em vendas trava também projetos) e recusam fase arquivada ou de outro quadro; card não nasce
em fase terminal; todo movimento grava `TransicaoFase` (origem `UI`) + Timeline
`MOVIMENTACAO`, e cada campo editado vira `CAMPO_ALTERADO { campo, antes, depois }`. Cor de
"dias na fase" (`aging.ts`): sem limite → neutro; `< 70%` do limite → verde; até o limite → âmbar;
`≥ limite` → vermelho.

**Ciclo único (GAB-81, spec fase 2 §4.1/§4.2).** O Projeto é um card só, do primeiro contato à
finalização. As fases são **marcos fixos** (`fase.marco`, regras em `src/lib/fases/marcos.ts`) e
**subfases** livres da Gestão entre eles. O ciclo aparece em dois quadros — o quadro do card é o
`pipeline` dele, então ele está em exatamente um: **Vendas** = [subfases] Proposta, Montando
contrato, [subfases] Ganho (= contrato assinado), Perdido; **Projetos** = Handoff (1ª coluna),
Execução, [subfases] Finalizado. Em Gestão → Fases, marco não é removido/arquivado, não muda de
tipo terminal e não sai da ordem canônica (Handoff sempre primeiro em Projetos); nome, cor e
alerta mudam, e subfases vão para qualquer lugar. As travas dos marcos (proposta aceita,
handoff fechado) vêm nos tickets de proposta/contrato/handoff.

Ganho/perdido (`terminal.ts`, regras puras em `terminal-regras.ts`), dentro da transação do
movimento — o servidor é a porta: sem o objeto `dadosTerminal` (pode ser `{}`) o movimento para
ganho em Vendas ou para perdido é recusado. **Ganho em Vendas**: diálogo com valor fechado
(opcional, BRL estrito: ponto só milhar, vírgula decimal — `12.500`, `1.234,56`), grava
`data_ganho` e o **mesmo card segue para o marco Handoff** no quadro Projetos (TransicaoFase
Ganho → Handoff, origem `SISTEMA`; Timeline `MOVIMENTACAO` com `motivo: "ganho_handoff"`). Não
existe mais segundo card: a coluna Ganho de Vendas é a porta de saída (fica vazia; só cards
migrados cujo projeto tinha sido apagado na v1 param nela). **Perdido** exige motivo (preço,
timing, concorrente, sem resposta, outro + texto) em qualquer quadro. **Reabrir mantém**
`data_ganho`/`valor_fechado` e `motivo_perda` (último fechamento; o diálogo seguinte vem
pré-preenchido, re-ganho atualiza a data). "Finalizado" em Projetos move direto. Remover fase em
Gestão só migra cards para fase do mesmo tipo (aberta, ganho ou perdido) — a migração não passa
pelo gancho. Vendas/Projetos ficam na navegação (lista pelo `?quadro=`; o detalhe declara o
quadro do card).

Migração da v1 (`prisma/migrations/20261030130000_ciclo_unico`): cada par venda → card de
projetos (`origem_oportunidade_id`) virou um Projeto (a venda sobrevive; Timeline,
TransicaoFase, prazos e mensagens do card de projetos passaram para ela; a casca fica
soft-deletada com `absorvido_por_id`, fora da lixeira). Exceção: venda fora do ganho (reaberta ou
perdida depois do ganho) com projeto vivo **não é unida** — ficam dois cards, um em cada quadro, com
link um para o outro na Timeline; re-ganho dessa venda segue para o Handoff como card próprio e avisa
nos dois (`reganho_projeto_existente`).
**Contrato assinado (GAB-99, spec fase 2 §4.2/§4.9).** Ganho só a partir de Montando contrato (ou de
subfase depois dele), mesmo com a proposta aceita: vale para arraste, WhatsApp e MCP, nem gestor
força (`trava-contrato.ts`, erro `GANHO_SO_DE_MONTANDO_CONTRATO`); restaurar da lixeira também não
entra em fase de ganho. Cards `isento_trava_contrato` seguem isentos. No detalhe do Projeto, o botão
"Contrato assinado" abre o diálogo de ganho, que aceita o PDF assinado (opcional, também no arraste);
`marcarContratoAssinado` (`contrato-assinado.ts`) é a porta da tela e da ferramenta MCP
`marcar_contrato_assinado`: confere a regra, anexa pelo sistema de anexos e só então move. WhatsApp
"assinou" fora da regra marca `revisar` e responde no grupo o que falta.
**Handoff (GAB-93, spec fase 2 §4.8/§4.11/§4.12).** O ganho leva o card à coluna Handoff e avisa os PMs de
projetos (app + WhatsApp privado, tipo `HANDOFF`). No detalhe do Projeto, o bloco Handoff reúne: GP do projeto
(designado pelo PM de projetos, pessoa da área projetos; vira a responsável e recebe aviso); checklist (proposta
final congelada, automática; PDF do contrato assinado; contatos, kickoff, acessos/materiais); e o resumo escrito
por vendas (contexto, combinados verbais, riscos, o que o cliente valoriza). Execução, e toda fase depois dela ou
de ganho no quadro, só com tudo fechado: arraste, MCP, card novo, lixeira e Gestão de fases, nem gestor força
(`trava-handoff.ts`, erro `HANDOFF_INCOMPLETO`, que diz o que falta). O WhatsApp só enxerga fases de Vendas e
trata card em Projetos como fechado. A trava olha a entrada: quem já está em Execução anda livre. O GP precisa
continuar valendo (ativo, área projetos) e ser o responsável; se o responsável mudou, designar de novo corrige. Na
lixeira, vale onde o card estava ao ser excluído (`alemDaExecucao` na EXCLUSAO). Isentos
(`isento_trava_handoff`): o que já estava no quadro Projetos no deploy e o que vem do import do Pipefy. Cards ainda
em Vendas no deploy passam pelo handoff.
O quadro Projetos tem uma fase Perdido, sem marco e obrigatória (`validarTerminais`): não passa pela trava, pede
motivo e pode reabrir. Perda em Projetos não é perda de venda: ranking e painel de vendas seguem contando o ganho e
não contam a perda (a venda aconteceu); ela aparece no Kanban, na Tabela e no detalhe do Projeto.
O PDF é identificado pela coluna `anexo.contrato_assinado` (um vivo por Projeto, com índice único parcial, sem olhar
nome): marcada pelo "Contrato assinado" com PDF e pelo checklist, que aceita enviar o arquivo ou
apontar um PDF já anexado. A proposta congela ao chegar em Projetos: toda escrita recusa (`PROPOSTA_CONGELADA`),
comentar continua; em card isento sem aceite, o item fica dispensado. Serviço em `handoff.ts`, o mesmo da tela e
das ferramentas MCP `ler_handoff`, `marcar_item_handoff`, `escrever_resumo_handoff`, `designar_gp_projeto`,
`definir_contrato_handoff` e `mover_para_execucao`.
**Execução (GAB-95, spec fase 2 §4.10/§4.12).** Ao entrar em Execução, ou em fase depois dela no quadro, o cronograma da
versão final da proposta aceita vira o previsto (`projeto_entrega`). Todo caminho passa por `aoEntrarEmExecucao`
(`execucao-entrada.ts`): arraste, MCP, lixeira e Gestão de fases. A cópia é idempotente: entrega ativa, ou já copiada mesmo se
cancelada, impede outra (`IMPEDE_COPIA`), então sair e voltar não recopia nem apaga. Na cópia, data inválida fica de fora
(`ignoradas` na Timeline) e valor inválido vira null. `previsto_original` nunca muda (trigger no banco); ajustar a data
muda `previsto_atual`, exige motivo e deixa linha em `entrega_ajuste`, append-only. Entrega feita guarda a data real
(`realizado_em`, DATE). Entrega cancelada, com motivo, mantém a linha e sai do cronograma ativo; não volta. Check-in
(`projeto_checkin`, append-only): verde, amarelo ou vermelho com uma linha de motivo, semana de segunda a domingo em São Paulo;
mais de um na semana vale, e o último é o badge do card, só com o card em Execução aberta. Sem controle de horas. Tudo vai para a
Timeline (tipo `EXECUCAO`). Painel: leia as duas tabelas, com `cancelada_em IS NULL` (`ENTREGA_ATIVA`).
Quem opera: o GP do projeto (o designado no handoff, enquanto ativo e da área projetos; sem ele, o responsável do card), com
ADMIN e GESTOR de projetos ou sem área de apoio. Os demais leem. Regra só em `podeOperarExecucao` (`execucao-regras.ts`), aplicada
em `recusaDeExecucao`; no MCP, a guarda `cardEditavel` vem antes. O PM de projetos troca o GP do projeto também em Execução, no bloco
e em `designar_gp_projeto`; o GP anterior recebe aviso só no app (`GP_TROCADO`). Trocar o campo Responsável não troca um GP válido. Fora de Execução o cronograma é só registro.
O GP designado conta como escalado na proposta (`ondeEscalado`). Quem não vê a proposta (`podeVerPropostaDoProjeto`) vê título e datas, sem valor, versão e `copiaveis`, e não copia
(`cronogramaSemProposta`; `timelineSemProposta` tira a versão de `cronograma_copiado`).
Card já em Execução no deploy e import do Pipefy: nada é copiado sozinho enquanto o card fica lá, nem ao andar entre subfases.
A entrega é lançada à mão, ou "Copiar da proposta final" se houver proposta aceita. Sair de Execução e voltar é nova entrada, e copia. O lembrete (`avisos/checkin.ts`, cron de manutenção, tipo `CHECKIN_ATRASADO`, só no app, ao GP)
cobra a semana que passou, um por semana e por Projeto (`lembrete_checkin`). A semana de entrada não é cobrada, nem o tempo na
lixeira, e card sem `execucao_desde` (isentos no deploy) só é cobrado depois de ter entrega ativa ou check-in. Com GP e
responsável inativos, ninguém é lembrado. Serviço em `execucao.ts`, o mesmo das ferramentas MCP `ver_cronograma`, `marcar_entrega`,
`ajustar_data_entrega`, `cancelar_entrega`, `adicionar_entrega`, `copiar_cronograma_proposta` e `registrar_checkin`.
O ganho guarda `vendedor_id` (responsável no momento do ganho); o ranking credita ganho/perda a ele. Deploy e rollback: runbook, "Ciclo
único (GAB-81)"; contagens antes/depois: `scripts/verificar-ciclo-unico.sql`.

## Empresas e Contatos

`/empresas` e `/contatos` (lista com busca + detalhe editável); no card, a seção "Empresa e
contato" vincula/cria inline (Timeline `CAMPO_ALTERADO { campo: "empresa"|"contato", antes,
depois }` com nomes). Normalização única em `src/lib/normalizacao.ts`: telefone → E.164 BR
(celular sem o 9 ganha o 9), email lowercase/trim, CNPJ alfanumérico (sem pontuação, maiúsculo,
DV módulo 11 com ASCII−48 — **nunca `\D`**), domínio de email/URL sem `www.`. Telefone/email
é único no sistema (`contato_ponto (tipo, valor_normalizado)`): repetir devolve o dono. Match
automático (ingestão/import) só por identificador exato, em `src/lib/contatos/match.ts`:
`encontrarContatoPorIdentificador(telefone|email)` (→ `ENCONTRADO | NAO_ENCONTRADO |
BLOQUEADO_EXCLUIDO`; o último vai para revisão humana, nunca cria) e `encontrarEmpresa(cnpj|dominio)`
(→ `{ empresa, via }`; **só `via: "cnpj"` vincula sozinho**, domínio é sugestão a confirmar).
Busca por nome é só autocomplete (curingas do LIKE escapados), nunca vínculo. Ingestão/import
passam `{ exigirDdi: true }` em `normalizarTelefoneBr`. Vínculo para registro excluído/mesclado
aparece como tal (`src/lib/entidades/vinculo.ts`), nunca como link ativo.

## Anexos do Projeto (GAB-84)

No detalhe do Projeto, a seção **Anexos** recebe PDF, Word (.docx), Markdown (.md), texto (.txt)
e imagens (PNG, JPEG, WebP) até 10 MB. Quem escreve anexa, de fora da área também; exclui o autor do anexo ou quem edita o card. VISUALIZADOR só baixa e lê.
Upload pela rota `POST /api/projetos/[id]/anexos` (corpo cru, nome em `X-Nome-Arquivo`, mesmo
molde do import do Pipefy); o **tipo vem dos bytes** (magic number, `src/lib/anexos/tipos.ts`) e
a extensão só precisa conferir com eles. No upload o texto é extraído sem LLM
(`src/lib/anexos/extrair.ts`): PDF digital pelo `unpdf` (pdf.js em JS puro) num **processo
filho** (`pdf-processo.ts` → `pdf-filho.mjs`, uma extração por vez, morto acima de 20 s ou
150 MB de RSS: o anexo entra "sem texto" e o log tem `[anexos.extrairTexto] ref=…`), .docx
pelo `word/document.xml` (zlib nativo com `maxOutputLength`, contra zip bomb), .md/.txt direto. PDF escaneado e
imagens ficam marcados **sem texto** (o texto deles só é lido pela IA quando o anexo é usado como base da proposta, GAB-90). O texto fica em `anexo.texto` (para a
proposta e o MCP) e abre em `/api/anexos/[id]/texto`. Download em `/api/anexos/[id]`: só com
sessão, `attachment` com o nome sanitizado, `nosniff` e CSP `sandbox` (posta pelo
`next.config`, que sobrescreve a da rota: `src/lib/rotas/seguranca.ts`). Pelo MCP:
`listar_anexos` e `ler_anexo` (texto em trechos). Arquivo repetido no mesmo
Projeto (mesmo sha256, índice único parcial) é recusado. Cada upload/exclusão vira Timeline `ANEXO`.

Os bytes ficam em disco, em `ANEXOS_DIR` (um arquivo por anexo, nome = id; dev nativo:
`.anexos/`), no compose o volume `app_anexos` em `/data/anexos`. **Fora do backup do banco**:
backup/restore à mão, runbook, "Anexos dos Projetos". Excluir manda para a **Lixeira** (aba
Anexos: gestor+ restaura, admin apaga de vez e o arquivo sai do disco); apagar o card de vez leva
os anexos e os arquivos.

## Proposta a partir de arquivo (GAB-90)

Na proposta, **Usar arquivo como base** escolhe um anexo do Projeto (ou envia um, que vira
anexo) e mostra uma **sugestão** para revisar: texto e parte estruturada (valor, prazo, escopo,
entregas). Nada é gravado até **Aplicar ao rascunho**, que põe o texto no editor e os dados no
formulário e grava pelos caminhos de sempre (autosave + "Salvar dados", com a revisão atual).
PDF digital/.docx/.md/.txt: o texto extraído no upload vira o texto; o LLM só preenche os dados.
PDF escaneado e imagem: o arquivo vai ao modelo do app com visão (`LLM_PROVEDOR`; produção
GPT-6.1 Sol, `store: false`), que transcreve e preenche numa chamada — sem OCR no servidor.
Campo sem trecho do arquivo que o sustente, ou com confiança ≤ 0,7 (conversões como "3 meses" vêm
com no máximo 0,5), **não é preenchido** — cada entrega do cronograma precisa do próprio trecho —: fica
como estava e aparece em "Para revisar" (`src/lib/propostas/sugestao.ts`). Só quem está com a caneta
(pingue-pongue em curso) usa, conferido antes de chamar o LLM. Nada do resultado do LLM é guardado; cada
leitura vira uma linha em `log_llm` (`operacao=proposta_arquivo`, tokens = custo por arquivo,
`ref=<ref>:<12 hex do anexo>`). Limites (VPS de 512 MB): 2 leituras ao mesmo tempo no
processo e 1 por pessoa (acima disso, recusa com mensagem); PDF escaneado com mais de 30 páginas é
recusado antes do LLM; a leitura com visão tem UMA tentativa (timeout de 120 s, sem retentativa).
Pelo MCP: `preencher_proposta_de_anexo` (só sugere; `aplicar=true`
+ `revisao` grava pelo `salvarRascunho`).

## Lixeira e merge

Qualquer usuário exclui um card (detalhe → Excluir): `deletado_em` + Timeline `EXCLUSAO`, e ele
some do Kanban, da Tabela, da Minha Semana e das Empresas/Contatos. **Gestão → Lixeira** (gestor+;
action e serviço recusam vendedor) lista cards, contatos e empresas excluídos, com busca, e
restaura: o card volta para a mesma fase; se ela foi arquivada nesse meio-tempo, é preciso
escolher uma fase ativa do mesmo tipo (aberta/ganho/perdido), gravada como movimento. Contatos e
empresas são excluídos por gestor+ no próprio detalhe (recusado se outros registros estão
mesclados nele: desfaça os merges antes). Na lixeira, telefone/email/CNPJ **seguem
bloqueados** (unique global; match devolve `BLOQUEADO_EXCLUIDO`). **Apagar de vez** é só admin,
só para o que já está na lixeira, digitando o título/nome: libera os identificadores, leva a
Timeline/histórico do card (cascade), deixa cards sem empresa/contato (FK `SET NULL`, com nota na
Timeline) e manda para a lixeira o que estava mesclado no registro apagado (só dado legado). Card
apagado: o card ligado (venda ↔ projeto) e os cards reabertos a partir dele sobrevivem sem o
ponteiro (`SET NULL` explícito no schema), com nota; mensagens enviadas ficam, sem card. Trava os
quadros de todos os cards envolvidos (`travarPipelines`) antes da linha.

Merge (gestor+, nunca automático) fica na seção "Duplicados" do detalhe de contato/empresa:
escolhe o outro registro e qual fica como principal, vê a prévia (quantos pontos/contatos/
projetos o principal vai mostrar) e confirma. É só o ponteiro `merged_into_id` no
perdedor: nada é copiado nem apagado; o principal lê o grupo (`idsDoGrupo` em
`src/lib/merge/merge.ts`), o perdedor some de listas/autocomplete e o link dele redireciona ao
principal. Um nível só: principal vivo e não mesclado, perdedor vivo, não mesclado e sem
mesclados nele (sem cadeia, sem ciclo). "Desfazer merge" limpa o ponteiro.

## Visibilidade por área (GAB-98)

Tudo no servidor: página, action, rota de API e MCP, com as regras puras de
`src/lib/auth/visibilidade.ts`. A automação do WhatsApp (#crm) não é restringida por área.

| Recurso | Quem |
|---|---|
| Tabela (e CSV), Ranking e Top 3 | Vendas, gestor de Vendas, gestor sem área e admin. Os outros: /403 |
| Painel | todos, como antes. No de projetos, o tempo com a caneta segue as propostas (GAB-96) |
| Mover e editar dados do card, excluir card | área dona (`pipeline.chave`), responsável do card, gestor sem área e admin |
| Criar card | quem é da área do quadro, gestor sem área e admin |
| Trocar o responsável | o responsável atual, GP do lado dono (GP de vendas, PM de projetos), gestor da área dona ou sem área, e admin |
| Restaurar card da lixeira | gestor da área dona ou sem área, e admin (e o responsável, se for gestor) |
| Handoff: itens e PDF do contrato | em Handoff, quem edita o card e quem é de Vendas (etapa conjunta, §4.7). O resumo continua de vendas |
| Handoff: Mover para Execução | Projetos, responsável, gestor sem área e admin |
| `propostaUrl` | ler e gravar só com acesso à proposta |
| Comentar, criar prazo e anexar em card de outra área | todo mundo que escreve |
| Proposta (lista, página, versões, diff, PDF, comentários, badge, eventos na Timeline, link) | responsável do card, dono e ex-dono da caneta, quem a criou, GP do lado (GP de vendas, PM de projetos), gestor com ou sem área e admin. VISUALIZADOR: nenhuma |
| Calendário e `/semana?vendedor=` | membro: só o próprio. Gestor com área: mesmo `ladoDe`. Gestor sem área e admin: todos. VISUALIZADOR: /403 |

Limitações: anexos seguem lidos por quem vê o card (decisão provisória, §4.7). Aviso antigo de quem perdeu
o acesso à proposta pode abrir em /403.

Ponto único de cada regra com banco: `src/lib/projetos/acesso-card.ts` (card) e
`src/lib/propostas/acesso.ts` (proposta). No MCP, a `guarda` de cada ferramenta roda em
`executarFerramenta`. A checagem de área fica fora de `moverCard`, `editarCard` e `aplicarPatch`
de propósito: são os núcleos que a automação usa.

## Minha Semana

`/semana` lista os cards abertos (vivos, fora de fase terminal) em que o usuário é responsável, por
faixa da próxima ação em dias civis de São Paulo — vencidas, hoje, próximos 7 dias (sem hoje),
sem próxima ação — com a mais urgente em destaque. As faixas vêm de `faixaProximaAcao`
(`src/lib/projetos/proxima-acao.ts`), a mesma do filtro do Kanban. "Marcar feita"
(`src/lib/projetos/feita.ts`) grava, numa transação, a NOTA "Feito: …" e a próxima ação
(ou "sem próxima ação", só por escolha explícita) como `CAMPO_ALTERADO`. `?vendedor=<id>` só vale
para gestor/admin e usuário ativo; para os demais o servidor ignora e mostra a própria semana.

## Tabela

`/tabela`: todos os projetos vivos (qualquer responsável e quadro: carteira é filtro, não parede), 50 por página, com filtro, ordenação e busca feitos no banco (`src/lib/tabela/`).

- **Estado na URL** (`src/lib/tabela/params.ts`), compartilhável e igual ao Kanban onde coincide: `quadro` (chaves de pipeline), `fase` (ids), `resp`, `origem` (`SEM` = sem origem), `revisar` e `terminais` (`sim`/`nao`), `acao` (`vencida,hoje,semana,sem`, mesmas faixas da Minha Semana), `de`/`ate` (criação, `YYYY-MM-DD` em SP, inclusivo), `q` (título, empresa ou contato vivos; sem acento, sem caixa e com espaços colapsados como no Kanban, via `public.unaccent` da migration `20261024174500_review_fixes`; `%`/`_` literais), `ordem`/`dir` (lista branca, desempate por id) e `pagina`. Valor inválido é ignorado.
- **CSV**: `GET /tabela/csv?<mesmos parâmetros>` exporta todas as linhas filtradas (sem limite de página), em streaming: UTF-8 com BOM, `;`, vírgula decimal e datas dd/mm/aaaa (abre direto no Excel pt-BR). Texto que começa com `= + - @`, tab ou CR (mesmo depois de espaços) ganha um `'` visível (mitigação padrão OWASP contra formula injection). Erro antes do primeiro byte → 500 com `ref`; erro no meio do streaming não vira 500 (o 200 já saiu): o arquivo termina com a linha `EXPORTAÇÃO INCOMPLETA: erro no servidor (ref: …)`, que é o sinal de arquivo truncado. Cada lote reaplica os filtros: toda linha exportada ainda batia neles no momento do lote, sem duplicar (não é um retrato único no tempo).
- **Busca: Tabela × Kanban** (diferença intencional). O Kanban busca em título + empresa, no cliente, sobre os cards já carregados do quadro; a Tabela busca também no nome do contato, no banco, porque é a visão de pesquisa geral. Empresa/contato aparecem (tela e CSV) e são buscados pelo nome exibido, na regra do Kanban (`nomeExibido`): mesclado (mesmo se também excluído) → nome da principal se ela estiver viva, senão o próprio nome; merge tem 1 nível (`validarMerge`). Excluído sem merge aparece com "(excluída)" e não é achado pelo nome.
- **Ordem de texto** (GAB-48): título, responsável, empresa e contato ordenam em pt-BR (`ij_ptbr`); empresa/contato pelo nome exibido (mesclado → principal viva; excluído sem merge → o próprio nome), na colação ICU `ij_ptbr` (pt-BR, criada pela migration `20261027140000_colacao_ptbr`; acento e caixa só desempatam; a colação padrão do banco no Alpine compara bytes), vazios por último nos dois sentidos, desempate por id. Toda página (e o CSV) lê os ids filtrados já ordenados, cruza com a busca em memória (nunca um `IN` gigante: o Postgres recusa mais de 32.767 parâmetros) e carrega só a fatia reaplicando os filtros. Limite conhecido: lê todos os ids filtrados por página, ok na escala atual; se crescer, keyset/`OFFSET` no SQL.

## Preferências de visualização

Opções de visualização de cada usuário (ex.: no Kanban, "mostrar colunas vazias" e colunas abertas à mão, por quadro) ficam em `usuario.preferencias` (JSONB versionado, validado com zod em `src/lib/preferencias/`); cada um só grava as próprias, e JSON inválido vira o padrão.

## Import do Pipefy

Gestão → Importar (GESTOR+) recebe o CSV de "exportar cards" do Pipefy, mostra a prévia (cards
por fase, novos × existentes, responsáveis sem usuário, linhas com erro) e só grava ao confirmar.
A prévia fica em `import_previa` (30 min, uso único) com `hash = sha256(CSV + mapeamento)`: o que
é aplicado é exatamente o que foi visto. O mapeamento de fases do Pipefy → fases do CRM vem por
nome normalizado (como o seed) e é editável na prévia. Idempotente por `pipefy_id`: importar de
novo atualiza, não duplica cards, transições nem timeline — mas não desfaz o CRM: card mexido no
CRM depois do último import (e depois do "Atualizado em" do CSV) é pulado e listado, e card em
fase terminal nunca sai dela. PERDIDO sem "Motivo da perda" é pulado, salvo se o gestor escolher
na prévia (ou `--motivo-perda` no CLI) um motivo padrão. O upload vai por
`/api/gestao/importar/previa` (limite só nessa rota); prévias vencidas são apagadas a cada prévia
e confirmação, e o CSV de uma prévia usada é descartado. Cards em "Contrato assinado" ou além
geram o projeto pelo caminho do GAB-32 (`aoEntrarEmTerminal`). Lotes de 25 cards por transação
(`travarPipelines`); lote que falha é refeito card a card. Limites: 8 MB, 5.000 linhas. Erros e
avisos por linha baixam em CSV.

Colunas: aliases pt-BR/en em `src/lib/importacao/pipefy/colunas.ts` (obrigatórias: ID do card,
Título, Fase atual); histórico por colunas "Primeira entrada na fase X" / "First time in X" etc.
gera `TransicaoFase` retroativas, sem histórico só `fase_desde`. Fixture de referência:
`src/test/fixtures/pipefy/export-exemplo.csv` (o export real ainda não foi validado).

Go-live pelo terminal (dry-run por padrão):

```bash
pnpm import:pipefy export.csv                       # prévia, grava export.csv.erros.csv
pnpm import:pipefy export.csv --confirmar           # importa como o 1º ADMIN ativo
pnpm import:pipefy export.csv --confirmar --usuario gestor@ij.com --mapa mapa.json --colunas colunas.json --motivo-perda sem_resposta
```

## Perfil e conta

Em **Meu perfil** cada um mexe só na própria conta:

- **Foto**: recorte quadrado e redimensionamento no navegador (canvas → WebP 256×256, JPEG se o
  navegador não codifica WebP). O servidor não confia no nome nem no `Content-Type`: valida os
  bytes (`src/lib/perfil/imagem.ts` — assinatura, tamanho declarado no cabeçalho, 256×256, sem
  animação, sem bytes sobrando, ≤ 150 KB). Sem `sharp`. Fica em `usuario_foto` (1:1) e é servida
  em `GET /api/usuarios/[id]/foto` (sessão obrigatória, `ETag`/304, `nosniff`); o `<Avatar>`
  (`src/components/avatar.tsx`) põe `?v=<atualizado_em>` na URL e cai para iniciais em 404.
- **Senha**: exige a atual; ao trocar, encerra as outras sessões. **Email**: exige a senha,
  normaliza e respeita a unicidade.
- **Sessões ativas**: dispositivo/navegador pelo user-agent; encerrar uma ou todas as outras.
  O "último uso" é regravado no máximo a cada 5 min (`SESSAO_TOQUE_MINUTOS`).
- **Página inicial**: o que abre dentro da área, Minha Semana ou Kanban (`preferencias.inicio`;
  os valores antigos `vendas` e `projetos` valem como Kanban). `/` redireciona no servidor para
  a área de entrada da pessoa. Veja a seção de áreas abaixo.

**Esqueci a senha** (`/esqueci`, link no login): resposta sempre igual (sem enumerar contas),
limite em memória de 10 pedidos por IP em 15 min e 3 por IP+email por hora (IP = último hop do
`X-Forwarded-For`, posto pelo Caddy — runbook §9). O pedido aparece em
Gestão → Usuários; gestor/admin gera o link (`/redefinir/<token>`: só o hash fica no banco, 1 h,
uso único, consumo atômico, encerra todas as sessões do usuário). Gestor só gera para vendedor;
admin gera para qualquer um, menos para si. Metadados da foto (COM/APPn, EXIF/XMP/ICCP) são
removidos antes de gravar.

## Ranking de vendas

`/ranking` (todos os papéis): Semana (seg–dom) | Mês, em dias de São Paulo, com navegação para
períodos anteriores (`?periodo=semana|mes&ref=YYYY-MM-DD`). Pódio Top 3, classificação completa
(você destacado), detalhamento dos seus pontos, feed dos últimos 7 dias (ganhos e avanços, só o
título do card), destaques do período e a tabela ordenável "Métricas por vendedor" com a linha
"Time". Card "Top 3 da semana" na lateral da Minha Semana.

Pontos são **calculados na leitura** a partir do histórico (`src/lib/ranking/calculo.ts`, puro;
uma consulta `UNION ALL` por período em `servico.ts`), só com cards vivos do quadro `vendas` e só
movimentos feitos por gente — origem `UI` ou `WHATSAPP`. `SISTEMA` (cards migrados ao arquivar/remover
fase) e `IMPORT` não pontuam e não contam como ganho nem perda:

| evento | pontos padrão | para quem |
|---|---|---|
| card em fase de ganho (entrou nela por UI/WhatsApp) com `data_ganho` no período | 100 + 1 por R$ 1.000 de `valor_fechado` (bônus até 100) | responsável do card |
| primeira entrada do card numa fase **aberta** de ordem maior (import não conta) | 5 | quem moveu (`transicao_fase.usuario_id`) |
| "Marcar feita" da Minha Semana (Timeline `NOTA` com `feito`), até 4 por vendedor por dia de SP (configurável) | 2 | quem marcou |
| card criado em Vendas (UI/WhatsApp) | 1 | quem criou |

Perdido vale 0 (entra na conversão, datado pela transição que o levou ao perdido); venda reaberta
perde o ganho e re-ganho conta pela nova `data_ganho`; migração entre duas fases de ganho não muda
nada. Desempate: mais ganhos → maior R$ fechado → quem chegou antes à pontuação. Aparecem usuários
ativos `VENDEDOR` e gestores/admins ativos com card vivo em Vendas, pontuando igual. Usuário
**desativado** sai da lista, das posições e dos destaques, mas os ganhos e valores dele continuam na
linha "Time" (é história do time). As datas são comparadas em UTC explícito no SQL
(`::timestamptz AT TIME ZONE 'UTC'`), independentes da `TimeZone` da sessão do Postgres; índices
`transicao_fase(em)` e `timeline(tipo, em)` cobrem os filtros por período.

**Gestão → Ranking** (gestor+): pesos, mínimos dos destaques (conversão: 3 fechadas; mais rápido:
2 ganhos) e "Mostrar ranking aos vendedores". Desligado, o servidor entrega ao vendedor só a própria
linha (sem posição) e o próprio feed. A config fica em `configuracao` (chave → JSONB, validada com
zod por chave em `src/lib/configuracao/`) — genérica para a config técnica do GAB-42. Linha
ausente = padrão; linha que não passa no schema = padrão + log `[configuracao.<chave>] ref=…` (só os
campos com problema, nunca o valor) e a tela avisa "valor salvo inválido". Gravação com concorrência
otimista: o formulário manda o `atualizado_em` que carregou e, se outra pessoa salvou no meio, recebe
"Outra pessoa alterou esta configuração. Recarregue para ver os valores atuais."

## Painel de vendas (GAB-94)

`/painel` (todos os papéis): Semana | Mês de São Paulo (`?periodo=semana|mes&ref=YYYY-MM-DD`) e
filtro por vendedor (`?vendedor=<id>`). **Visibilidade** = `podeVerPainelCompleto`: com
"Mostrar ranking aos vendedores" desligado, vendedor e projetos veem os totais do time e só as
próprias linhas, sem filtro por outra pessoa (o servidor recusa; o MCP responde com erro); gestor,
admin e visualizador veem tudo. Quatro
perguntas, sem dashboards configuráveis; barras em HTML/CSS (sem biblioteca de gráficos):

- **Estamos convertendo?** ganhos, perdidos, conversão e R$ fechado com as regras do ranking; por
  fase aberta de Vendas, entradas, saídas (avanço/perda/recuo), conversão da fase
  (avanços ÷ (avanços + perdas)) e tempo médio na fase; no filtro por vendedor o card conta para o
  responsável ATUAL. Valor em proposta e versões até fechar
  mostram "sem dados" até a Proposta (GAB-86) — ponto de encaixe em `src/lib/painel/proposta.ts`.
- **O time está engajado?** interações por vendedor (WhatsApp `#crm`, tela e MCP) e próximas ações
  feitas no prazo (dia de SP).
- **Os leads estão sendo acompanhados?** (agora) cards abertos sem próxima ação, vencidos e dias
  desde o último contato, com os 10 mais parados.
- **Os leads gostaram do contato?** nota média 1–5 e sentimento (`avaliacoesPorVendedor`, GAB-85,
  com `soVendas`: só enquanto o card estava em Vendas).

Cálculo puro em `src/lib/painel/calculo.ts` (fórmulas no topo; texto em `definicoes.ts`); uma
consulta agregada por indicador em `servico.ts`, em paralelo. Só movimentos de gente (`UI`/
`WHATSAPP`): importação do Pipefy (`IMPORT`) e migração (`SISTEMA`) não contam como movimento, mas
a data de entrada importada abre a estadia na fase. Lixeira e cascas absorvidas (`absorvido_por_id`)
ficam de fora. Pelo MCP: `consultar_painel_vendas` (indicador, período, `ref`, vendedor), mesmos
números da tela e as definições junto.

## Painel de projetos (GAB-96)

`/painel/projetos`, aba do Painel: responde "o projeto está andando de acordo com a proposta?", com filtro por
GP (`?gp=<id>`) e Semana | Mês de São Paulo (`?periodo=`, `?ref=`). Sem dashboards configuráveis; barras em HTML/CSS, com
cor funcional só em ponto e borda.

- **Execução:** cada projeto aberto de Execução em diante, com entregas previstas × feitas no período, atrasadas, atraso
  acumulado, ajustes e último check-in. Entrega cancelada, e os ajustes dela, não entra em nenhuma conta (`ENTREGA_ATIVA`).
  Projeto sem entrega ativa aparece como "sem previsto" e não conta como atrasado.
- **Atraso acumulado:** soma dos dias além do previsto ORIGINAL, o que a proposta combinou. Ajustar a data não apaga o atraso, então a conta inclui dias ainda não passados quando a data foi empurrada para o futuro; entrega adiantada não compensa outra. `atrasadas` é a mesma conta do `ver_cronograma` (previsto atual antes de hoje).
- **Alertas:** vermelho e amarelo pelo último check-in, e sem check-in na semana corrente, com a mesma regra de início do lembrete (`inicioDoAcompanhamento`).
- **Tempo com a caneta:** propostas paradas por pessoa agora (em curso ou prontas para envio, com o card aberto em Vendas), desde a chegada da caneta e com a última edição ao lado, e tempo no período, sem as esperas pelo cliente (eventos da Timeline). Caneta aberta em card encerrado ou fora de Vendas para de contar em `fase_desde`.
- **Handoff, Finalizado e Perdido** não são execução. Finalizado e Perdido aparecem em "Encerrados" se encerraram no período ou têm entrega nele: fora de atraso e alertas, mas com previstas e feitas somadas ao total do período, para um mês passado não mudar. Perdido antes de começar não aparece.

| Quem | Execução e alertas | Tempo com a caneta |
|---|---|---|
| Admin, gestor com ou sem área, GP de vendas / PM de projetos (`veTodasAsPropostas`) | tudo | todas as propostas |
| Membro com ranking visível | tudo | só as propostas em que está escalado (`filtroPropostasVisiveis`) |
| Membro com ranking oculto | tudo | como acima, e só as próprias linhas |
| Visualizador | tudo | não vê: seção some, e a ferramenta recusa |

A execução é aberta porque o cronograma de cada projeto já é (`ver_cronograma`), e ela não lê valor nem versão da
proposta. `podeVerPainelCompleto` não governa a caneta sozinho, porque abre tudo ao visualizador: a regra é `visaoDaCanetaNoPainel`.

Cálculo puro em `src/lib/painel/projetos-calculo.ts`, fórmulas em `definicoes.ts`, leitura em `projetos-servico.ts`, com poucas
consultas e índices existentes, sem migration. Pelo MCP, com os mesmos números: `consultar_execucao_projetos`,
`listar_projetos_atrasados`, `listar_projetos_em_alerta` e `consultar_tempo_caneta_proposta`, com listas limitadas a 50 itens, totais completos e `foraDaLista`.

## Admin: configuração técnica e logs

Só ADMIN (gestor recebe 403): **Gestão → Admin**.

- **Configuração** — `GRUPO_JID` (botão "Listar grupos" consulta a Evolution:
  `GET /group/fetchAllGroups/{instância}?getParticipants=false`), provedor e modelos de
  extração/classificação, limiares (com #crm, sem #crm, classificador) e timeout de envio.
  Fica na tabela `configuracao` (chave `tecnica`, schema zod em `src/lib/config/tecnica.ts`).
  Precedência **config > env > padrão**: o valor salvo vira sobrescrita das variáveis lidas por
  `src/lib/config/env.ts` (mesmas validações de lá). Campo vazio = herda do env.
- Salvar recusa combinação inválida (em português): modelo de outro provedor, limiar sem
  #crm < com #crm, `mock` em produção, JID que não é de grupo, e qualquer salvar/restaurar que
  deixe o CRM **sem grupo** (nem aqui nem no env). Grupo novo precisa estar em "Listar grupos";
  com a Evolution fora, só com "salvar mesmo assim". Concorrência otimista (salvar e restaurar).
- Modelo de classificação e limiares sem #crm/classificador valem para o classificador sem
  #crm (GAB-39): ele lê pelas mesmas funções de `env.ts`, então segue a config daqui (inclusive a
  regra sem #crm ≥ com #crm). No boot, `instrumentation.ts` carrega a config antes de
  `validarConfigLlm()`. As chamadas do classificador também aparecem em Logs.
- **Cache**: a config é lida do banco uma vez por processo (entrada do webhook e de
  `processarMensagem`) e fica em memória; salvar/restaurar aplica na hora, então vale já na
  próxima mensagem. Funciona porque o app roda em **um processo Next** — com réplicas seria
  preciso TTL ou `LISTEN/NOTIFY`. Edição manual da linha no banco só vale após reiniciar.
  Uma geração no cache impede que uma carga lenta sobrescreva um salvar feito no meio dela.
  Config salva que virou inválida com o env (ex.: trocaram o provedor no env) é ignorada na
  carga (log com ref, só a chave) e a tela avisa. Banco fora na carga → webhook responde 503
  (a Evolution re-tenta) e `processarMensagem` não reivindica (fica RECEBIDA para o cron).
- Segredos (chaves de API, chave da Evolution, segredo do webhook) e o safe mode
  (`NOTIFICATIONS_ENABLED`) **não** são editáveis: a tela mostra só configurada/ausente e um
  o safe mode com o ambiente: em produção avisa quando o bot está calado; fora dela, quando envia.
  Também mostra quantos eventos de outro chat chegaram na última hora (sinal de GRUPO_JID errado).
- **Estado da Evolution** (`GET /instance/connectionState/{instância}`) e botão "Mostrar QR"
  (`GET /instance/connect/{instância}`; com a instância fechada isso inicia uma conexão). O QR
  vincula o WhatsApp: action só-ADMIN, nunca logado nem cacheado, some ao fechar.
- **Logs** — últimos 200 eventos do webhook (hora, tipo, chat mascarado, HTTP, resultado, ms)
  e 200 chamadas de LLM (modelo, tokens de entrada/saída/raciocínio, ms, status, ref da
  mensagem). Tabelas `log_webhook`/`log_llm` em anel: cada inserção apaga o que passou do
  limite (`src/lib/logs/tecnicos.ts`). Nunca texto de mensagem, telefone ou email; tipo,
  resultado e modelo só entram se parecem identificadores. Falha ao gravar log não afeta o
  webhook. **401 não entra na tabela** (um flood empurraria os eventos reais): só um contador em
  memória (zera ao reiniciar), mostrado em Logs, e no máximo uma linha `[webhook] … (401)` por
  minuto no console. "Listar grupos" tem timeout próprio de 60 s.

## Erros e debug

Exceção inesperada numa server action não vira tela de erro: a action devolve
`erro: "INESPERADO"` com uma `ref` curta (8 hex), mostrada ao usuário ("Erro no servidor
(ref: abc123de)"). Peça a ref e procure no log do servidor: `grep 'ref=abc123de'` (ou
`docker compose logs app | grep ref=abc123de`). A linha traz contexto, tipo e 3 frames do stack;
erro do Prisma só loga `code` + `target`/`modelName` (a mensagem ecoa dados da query).
"Sem conexão com o servidor" = a chamada nem chegou (rede/servidor fora). Helper:
`src/lib/erros/registrar.ts` (`comTratamento` / `comTratamentoForm`).

## Produção e deploy

A produção roda no **Coolify** (`compose.coolify.yml`). Configuração e detalhes em
[`docs/coolify.md`](docs/coolify.md); o [`docs/runbook.md`](docs/runbook.md)
descreve também a instalação standalone (`compose.prod.yml` + `scripts/deploy.sh`
numa VM própria), que não é a produção atual.

### Como funciona

```
PR para a main
   │  GitHub Actions: build (next build, o mesmo do Coolify),
   │  verificacoes (migrations destrutivas, compose do Coolify, scripts)
   ▼
merge na main
   │  GitHub Actions: imagens (publica ij-crm-app/ij-crm-ops no GHCR;
   │  o Coolify não usa, servem ao standalone)
   ▼
Coolify → botão Redeploy (manual)
   1. builda o Dockerfile no servidor (prisma generate + next build)
   2. serviço one-shot `migrate`: prisma migrate deploy
   3. sobe o app (só depois do migrate terminar com 0)
```

- **O deploy é manual**: nada vai ao ar só com o merge. Não existe mais deploy
  automático via AWS SSM.
- **Não há backup automático** antes do deploy. Com migration nova, faça o
  backup do PostgreSQL no painel do Coolify (ou `pg_dump`) antes do Redeploy.
- **Check `build` vermelho no PR = o Redeploy quebraria.** Não mergeie assim.
- **Rollback**: revert na `main` + Redeploy. O schema do banco não volta (veja
  expand/contract abaixo).

### Migrations: expand/contract

O rollback troca só o app; o schema do banco não volta. Por isso, toda migration
tem de funcionar também com a versão **anterior** do app:

- **Livre:** adicionar tabela, coluna ou índice.
- **Em duas releases:** remover, renomear ou trocar tipo. Na 1ª, o código para
  de usar o campo. Na 2ª, a migration remove, com a linha
  `-- destrutiva-ok: <motivo>`.

O CI (`scripts/checar-migrations.sh`) recusa migration nova com `DROP TABLE`,
`DROP COLUMN`, `ALTER COLUMN … TYPE` ou `RENAME` sem esse marcador. Detalhes no
runbook §2.

### Trocar o provedor de LLM (OpenAI ↔ Gemini ↔ Anthropic)

Nas **Environment Variables** do recurso no Coolify, defina `LLM_PROVEDOR=gemini`
(ou `openai`/`anthropic`) e a chave correspondente (`GEMINI_API_KEY`,
`OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`) e faça Redeploy. Também dá para trocar
provedor e modelo em **Gestão → Admin → Configuração**, sem deploy; as chaves,
porém, ficam só no ambiente. Detalhes (e o `llm-smoke`) no runbook §10.

### Primeira instalação (uma vez só)

No Coolify: [`docs/coolify.md`](docs/coolify.md). Standalone numa VM própria:
**[Checklist de go-live](docs/runbook.md#checklist-de-go-live-standalone)** do
runbook. Nos dois casos, depois de subir: criar o admin
(`scripts/criar-admin.ts`), parear o WhatsApp e escolher o grupo em Gestão →
Admin, publicar o aviso de privacidade **antes** de ligar o webhook, e só por
último `NOTIFICATIONS_ENABLED=true`.

Limites de memória e medições: runbook §11.

## Áreas e gaveta da IJ

Spec: `docs/superpowers/specs/2026-11-03-areas-hub-design.md`. As URLs não mudam; o que muda é o menu.

- **Gaveta:** o ícone da IJ (rail; topbar no mobile) abre áreas e Geral (Painel, Gestão, Meu perfil).
  Nunca abre sozinha.
- **Menu por área:** a regra pura está em `src/lib/auth/visibilidade.ts` (`itensDaArea`, `podeVerItem`);
  `href` e ícones em `src/components/shell/nav-config.ts`. Hoje só o menu filtra; o bloqueio no
  servidor é do GAB-98.
- **Área atual:** `/kanban` pelo quadro, `/projetos/[id]` pelo quadro do card, Tabela e Ranking são de
  Vendas, Minha Semana é da área da pessoa. Nas outras rotas vale a última área aberta (cookie
  `ij_area`, apagado no login e no logout), e sem cookie a de entrada. Ao abrir `/`, a entrada vence
  a última área: quem é das duas áreas vai a `/semana?area=<ÁREA>`, e o menu e o cookie seguem.
- **Entrada (`/`):** membro e gestor com área entram na própria. ADMIN, gestor sem área e visualizador
  entram na `usuario.area_entrada`, definida em Gestão de usuários (sem valor = Geral = `/painel`).
  Essa coluna não dá lado na caneta; quem dá é `usuario.area`.

## Testes

`pnpm test` roda unitários e de integração. Os de integração (`*.int.test.ts`)
usam o Postgres do compose num schema de teste, migrado automaticamente —
suba o `db` antes (`docker compose up -d db`). O schema é o de `DATABASE_URL_TEST`
quando definida (precisa ser `ijcrm_test` ou `ijcrm_test_<sufixo>`); sem ela, cada
diretório/worktree usa o seu, `ijcrm_test_<8 hex do sha256 do caminho>` (`src/test/db.ts`),
para que worktrees em paralelo nunca truncem as tabelas um do outro. Apague os schemas
de worktrees removidos com `DROP SCHEMA ijcrm_test_<hash> CASCADE`.

## Comandos

| comando | faz |
|---|---|
| `pnpm check` | lint + typecheck + testes |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm prisma:migrate` | `prisma migrate dev` |
| `pnpm db:seed` | seed idempotente de pipelines/fases |
| `pnpm db:studio` | Prisma Studio |

## Stack

Next.js (App Router, Server Actions) · Prisma · Postgres 16 · Tailwind 4 + shadcn/ui ·
Vitest. Um container de app, um Postgres, Evolution API no mesmo compose (GAB-28).

## Convenções

- Tema escuro único; tokens em `src/app/globals.css`, nunca hex solto em componente.
- Domínio em português (`Projeto`, `Fase`, `Contato`); tabelas `snake_case` via `@map`. O model `Projeto` (ex-`Oportunidade`, GAB-80) continua na tabela física `oportunidade`.
- `NOTIFICATIONS_ENABLED` **nunca** `true` fora de produção — envios só são logados.
- **Toda página que lê dados e toda server action chama `exigirUsuario()` /
  `exigirPapel()`** (`src/lib/auth/atual.ts`). O guard do layout `(app)` não
  re-executa em navegação client-side; o `proxy.ts` só checa presença do cookie.
- Commits em Conventional Commits; branch + PR; PR revisado antes de merge.
