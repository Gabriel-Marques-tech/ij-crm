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

O compose sobe a Evolution API v2 (`evolution` + `evolution-db` + `evolution-redis`) em
`127.0.0.1:8080`. Ela precisa de `EVOLUTION_API_KEY` no `.env` (é a chave global da
instância). Depois de `docker compose up -d evolution`:

```bash
source .env   # para usar $EVOLUTION_API_KEY e $EVOLUTION_WEBHOOK_SECRET abaixo

# 1. Criar a instância (nome = EVOLUTION_INSTANCE)
curl -s -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
  -d '{"instanceName":"ij-crm","integration":"WHATSAPP-BAILEYS","qrcode":true}'

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

Segurança do webhook: a Evolution **não** manda a apikey como header — ela vai no corpo.
Por isso o segredo vai em `webhook.headers` (`x-webhook-secret`; o header `apikey` também é
aceito). `EVOLUTION_WEBHOOK_SECRET` vazio ⇒ tudo recebe 401; `GRUPO_JID` vazio ⇒ 503.
Em dev, `NOTIFICATIONS_ENABLED` fica ausente: a confirmação "📥 recebido" só aparece no
log como `[SAFE MODE] WhatsApp NÃO enviado para 12****01@g.us`.

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
