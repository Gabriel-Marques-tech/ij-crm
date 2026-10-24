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
