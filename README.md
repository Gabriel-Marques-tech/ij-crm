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
