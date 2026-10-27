# ij-crm

CRM interno da Inteli Júnior. Substitui o Pipefy: Kanban de vendas + leads entrando
pelo grupo de WhatsApp (Evolution API + LLM). Design completo em
[`docs/superpowers/specs/2026-10-24-ij-crm-design.md`](docs/superpowers/specs/2026-10-24-ij-crm-design.md).

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
vale 7 dias, e quem abre define a própria senha. Papéis: `VENDEDOR` (opera),
`GESTOR` (+ usuários, fases, import), `ADMIN` (+ config técnica). Sessões vivem no
banco (`sessao`): desativar alguém derruba o acesso na hora.

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
`#crm` está em [#crm → card](#crm--card-llm); o classificador sem tag é GAB-39.

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
sem nome de contato nem de empresa → não cria, `PENDENTE_REVISAO`; `ATUALIZAR`/`IGNORAR` →
`PENDENTE_REVISAO` (atualização é a próxima fatia); responsável = remetente, trocado só por nome
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

## Provedor de LLM (OpenAI padrão, Anthropic alternativa)

`src/lib/llm/provedores/`: `openai.ts` (padrão de produção, GAB-45), `anthropic.ts` e `mock.ts`,
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
- **Deploy**: `scripts/deploy.sh` recusa o deploy se o provedor selecionado não tem chave
  (`scripts/_llm.sh`).
- Trocar: `LLM_PROVEDOR=openai|anthropic` + a chave (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`);
  `LLM_EXTRACAO_MODELO` vazio = padrão do provedor (`gpt-6.1-sol`/`claude-haiku-5-5`); modelo do
  outro provedor → `FALHA` "PROVEDOR_INVALIDO". `mock` é recusado em produção.
- Log por chamada: `[llm] extracao ref=<id> provedor=openai modelo=gpt-6.1-sol versao=extracao.v1
  ms=… tokens_in=… tokens_out=… tokens_reasoning=… ok` (`tokens_out` já inclui os de raciocínio).
- Crédito pré-pago com recarga manual (auto-reload desligado, mínimo US$ 5, expira em 1 ano,
  sugestão US$ 50 a cada ~3 meses): `docs/runbook.md` §10.

## Alerta de sem crédito na LLM

GAB-46. A recarga da API de LLM é manual (pré-pago). Quando uma chamada falha com `SEM_CREDITO`
(qualquer provedor), o caminho de `FALHA` de `processar.ts` chama `alertarSeSemCredito`
(`src/lib/llm/alerta-credito.ts`), que:

- manda `⚠️ Sem crédito na API de LLM. Mensagens do grupo estão ficando em FALHA e serão reprocessadas
  depois da recarga. ref: …` para `ALERTA_OPS_JID` pelo `enviarWhatsApp` de sempre (timeout 60 s);
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

## Kanban

`/kanban` (Vendas; `?quadro=projetos` para Projetos) e detalhe em `/kanban/[id]`. Serviço em
`src/lib/oportunidades/`: criar/mover tomam o lock de pipeline (`travarPipelines`, ordem por id;
ganho em vendas trava também projetos) e recusam fase arquivada ou de outro quadro; card não nasce
em fase terminal; todo movimento grava `TransicaoFase` (origem `UI`) + Timeline
`MOVIMENTACAO`, e cada campo editado vira `CAMPO_ALTERADO { campo, antes, depois }`. Cor de
"dias na fase" (`aging.ts`): sem limite → neutro; `< 70%` do limite → verde; até o limite → âmbar;
`≥ limite` → vermelho.

Ganho/perdido (`terminal.ts`, regras puras em `terminal-regras.ts`), dentro da transação do
movimento — o servidor é a porta: sem o objeto `dadosTerminal` (pode ser `{}`) o movimento para
ganho em Vendas ou para perdido é recusado. **Ganho em Vendas**: diálogo com valor fechado
(opcional, BRL estrito: ponto só milhar, vírgula decimal — `12.500`, `1.234,56`), grava
`data_ganho` e cria o card em Projetos (fase de chave `em_execucao`, mesmo
título/responsável/empresa/contato, `origem_oportunidade_id`). Um projeto por venda, garantido no
banco (`origem_oportunidade_id` único; P2002 de outro escritor no meio do ganho → o movimento é
refeito e só registra o vínculo). **Perdido** exige motivo (preço, timing, concorrente, sem
resposta, outro + texto) em qualquer quadro. **Reabrir mantém** `data_ganho`/`valor_fechado` e
`motivo_perda` (último fechamento; o diálogo seguinte vem pré-preenchido, re-ganho atualiza a
data). Se a venda sai do ganho, o projeto não é movido nem apagado: ganha uma entrada na Timeline
e um aviso ("venda reaberta/perdida") enquanto a venda não voltar a ganho. "Finalizado" em
Projetos move direto. Remover fase em Gestão só migra cards para fase do mesmo tipo (aberta,
ganho ou perdido) — a migração não passa pelo gancho. Vendas/Projetos ficam na navegação (lista
pelo `?quadro=`; o detalhe declara o quadro do card).

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
oportunidades o principal vai mostrar) e confirma. É só o ponteiro `merged_into_id` no
perdedor: nada é copiado nem apagado; o principal lê o grupo (`idsDoGrupo` em
`src/lib/merge/merge.ts`), o perdedor some de listas/autocomplete e o link dele redireciona ao
principal. Um nível só: principal vivo e não mesclado, perdedor vivo, não mesclado e sem
mesclados nele (sem cadeia, sem ciclo). "Desfazer merge" limpa o ponteiro.

## Minha Semana

`/semana` lista os cards abertos (vivos, fora de fase terminal) em que o usuário é responsável, por
faixa da próxima ação em dias civis de São Paulo — vencidas, hoje, próximos 7 dias (sem hoje),
sem próxima ação — com a mais urgente em destaque. As faixas vêm de `faixaProximaAcao`
(`src/lib/oportunidades/proxima-acao.ts`), a mesma do filtro do Kanban. "Marcar feita"
(`src/lib/oportunidades/feita.ts`) grava, numa transação, a NOTA "Feito: …" e a próxima ação
(ou "sem próxima ação", só por escolha explícita) como `CAMPO_ALTERADO`. `?vendedor=<id>` só vale
para gestor/admin e usuário ativo; para os demais o servidor ignora e mostra a própria semana.

## Tabela

`/tabela`: todas as oportunidades vivas (qualquer responsável e quadro: carteira é filtro, não parede), 50 por página, com filtro, ordenação e busca feitos no banco (`src/lib/tabela/`).

- **Estado na URL** (`src/lib/tabela/params.ts`), compartilhável e igual ao Kanban onde coincide: `quadro` (chaves de pipeline), `fase` (ids), `resp`, `origem` (`SEM` = sem origem), `revisar` e `terminais` (`sim`/`nao`), `acao` (`vencida,hoje,semana,sem`, mesmas faixas da Minha Semana), `de`/`ate` (criação, `YYYY-MM-DD` em SP, inclusivo), `q` (título, empresa ou contato vivos; sem acento, sem caixa e com espaços colapsados como no Kanban, via `public.unaccent` da migration `20261024174500_review_fixes`; `%`/`_` literais), `ordem`/`dir` (lista branca, desempate por id) e `pagina`. Valor inválido é ignorado.
- **CSV**: `GET /tabela/csv?<mesmos parâmetros>` exporta todas as linhas filtradas (sem limite de página), em streaming: UTF-8 com BOM, `;`, vírgula decimal e datas dd/mm/aaaa (abre direto no Excel pt-BR). Texto que começa com `= + - @`, tab ou CR (mesmo depois de espaços) ganha um `'` visível (mitigação padrão OWASP contra formula injection). Erro antes do primeiro byte → 500 com `ref`; erro no meio do streaming não vira 500 (o 200 já saiu): o arquivo termina com a linha `EXPORTAÇÃO INCOMPLETA: erro no servidor (ref: …)`, que é o sinal de arquivo truncado. Cada lote reaplica os filtros: toda linha exportada ainda batia neles no momento do lote, sem duplicar (não é um retrato único no tempo).
- **Busca: Tabela × Kanban** (diferença intencional). O Kanban busca em título + empresa, no cliente, sobre os cards já carregados do quadro; a Tabela busca também no nome do contato, no banco, porque é a visão de pesquisa geral. Empresa/contato aparecem (tela e CSV) e são buscados pelo nome exibido, na regra do Kanban (`nomeExibido`): mesclado (mesmo se também excluído) → nome da principal se ela estiver viva, senão o próprio nome; merge tem 1 nível (`validarMerge`). Excluído sem merge aparece com "(excluída)" e não é achado pelo nome.
- **Ordem por empresa/contato** (GAB-48): pelo nome exibido (mesclado → principal viva; excluído sem merge → o próprio nome), na colação ICU `ij_ptbr` (pt-BR, criada pela migration `20261027140000_colacao_ptbr`; acento e caixa só desempatam; a colação padrão do banco no Alpine compara bytes), vazios por último nos dois sentidos, desempate por id. Toda página (e o CSV) lê os ids filtrados já ordenados, cruza com a busca em memória (nunca um `IN` gigante: o Postgres recusa mais de 32.767 parâmetros) e carrega só a fatia reaplicando os filtros. Limite conhecido: lê todos os ids filtrados por página, ok na escala atual; se crescer, keyset/`OFFSET` no SQL.

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
- **Página inicial**: Minha Semana, Kanban Vendas ou Kanban Projetos (`preferencias.inicio`);
  `/` redireciona no servidor.

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
- Modelo de classificação e limiares sem #crm/classificador só valem depois do classificador
  sem #crm (GAB-39) — a tela marca isso.
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

## Produção

Deploy, rollback, backup/restore, QR da Evolution e troca do número do bot:
[`docs/runbook.md`](docs/runbook.md) (`compose.prod.yml` + `scripts/deploy.sh`).
As imagens são buildadas no GitHub Actions a cada push na `main` e publicadas no
GHCR; a VPS só baixa (`scripts/deploy.sh [sha-<commit>]`). Limites de memória e
instância mínima: runbook §11.

## Testes

`pnpm test` roda unitários e de integração. Os de integração (`*.int.test.ts`)
usam o Postgres do compose no schema `ijcrm_test`, migrado automaticamente —
suba o `db` antes (`docker compose up -d db`).

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
- Domínio em português (`Oportunidade`, `Fase`, `Contato`); tabelas `snake_case` via `@map`.
- `NOTIFICATIONS_ENABLED` **nunca** `true` fora de produção — envios só são logados.
- **Toda página que lê dados e toda server action chama `exigirUsuario()` /
  `exigirPapel()`** (`src/lib/auth/atual.ts`). O guard do layout `(app)` não
  re-executa em navegação client-side; o `proxy.ts` só checa presença do cookie.
- Commits em Conventional Commits; branch + PR; PR revisado antes de merge.
