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
Em dev, `NOTIFICATIONS_ENABLED` fica ausente: a confirmação "📥 recebido" só aparece no
log como `[SAFE MODE] WhatsApp NÃO enviado para 12****01@g.us`.

A Evolution não guarda mensagens, contatos nem chats no banco dela (`DATABASE_SAVE_DATA_*=false`
— design §2); a confirmação cita a mensagem original mandando `quoted.key` **e** `quoted.message`.

Nesta fatia (GAB-28) o bot só reage a mensagens com `#crm` de usuários ativos com
`telefoneWhatsapp`/`whatsappLid` cadastrado; o resto é contado (`contador_descartadas`,
`remetente_desconhecido`) e descartado sem persistir conteúdo. Classificação e LLM entram no
GAB-34/GAB-39.

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

`/` lista os cards abertos (vivos, fora de fase terminal) em que o usuário é responsável, por
faixa da próxima ação em dias civis de São Paulo — vencidas, hoje, próximos 7 dias (sem hoje),
sem próxima ação — com a mais urgente em destaque. As faixas vêm de `faixaProximaAcao`
(`src/lib/oportunidades/proxima-acao.ts`), a mesma do filtro do Kanban. "Marcar feita"
(`src/lib/oportunidades/feita.ts`) grava, numa transação, a NOTA "Feito: …" e a próxima ação
(ou "sem próxima ação", só por escolha explícita) como `CAMPO_ALTERADO`. `?vendedor=<id>` só vale
para gestor/admin e usuário ativo; para os demais o servidor ignora e mostra a própria semana.

## Preferências de visualização

Opções de visualização de cada usuário (ex.: no Kanban, "mostrar colunas vazias" e colunas abertas à mão, por quadro) ficam em `usuario.preferencias` (JSONB versionado, validado com zod em `src/lib/preferencias/`); cada um só grava as próprias, e JSON inválido vira o padrão.

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
