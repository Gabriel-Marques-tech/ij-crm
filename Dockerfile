# syntax=docker/dockerfile:1

# Estágios:
#   dev      → compose.yml (dev): código montado como volume
#   deps     → node_modules completo (pnpm install --frozen-lockfile)
#   build    → prisma generate + next build (output: standalone)
#   ops      → imagem one-shot de migrations/seed/admin (compose.prod.yml, serviço `migrate`)
#   runtime  → imagem de produção enxuta (compose.prod.yml, serviço `app`)
#
# Todos partem de node:22-bookworm-slim (glibc + OpenSSL 3): o engine do Prisma
# gerado no `build` (debian-openssl-3.0.x) é o mesmo que o `runtime` precisa.

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dev: used by compose.yml (source mounted as a volume) ----
FROM base AS dev
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
# Roda como `node` (uid 1000) em vez de root: arquivos que o `next dev` escreve no
# bind mount (next-env.d.ts, tsbuildinfo) ficam editáveis pelo usuário do host.
# Os diretórios abaixo precisam existir com dono `node` ANTES do volume nomeado
# ser montado — o Docker copia a ownership para o volume novo.
RUN mkdir -p /app/node_modules /app/.next && chown -R node:node /app
USER node
ENV HOME=/home/node
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- deps ----
FROM base AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# O postinstall do @prisma/client precisa do schema para gerar o client.
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
# `public/` é opcional no repo; garante que exista para o COPY do runtime.
RUN ./node_modules/.bin/prisma generate && pnpm build && mkdir -p public

# Poda do standalone (~60 MB): o app usa só o engine nativo (library) do Prisma
# para Postgres; os runtimes wasm/edge e os de outros bancos nunca carregam.
# sharp/libvips: nenhuma página usa next/image (se passar a usar, remova a poda).
FROM build AS standalone
RUN set -eu; cd .next/standalone/node_modules/.pnpm; \
    for d in @prisma+client*/node_modules; do \
      rm -f "$d"/@prisma/client/runtime/*.wasm-base64.* \
            "$d"/@prisma/client/runtime/query_compiler_bg.* \
            "$d"/@prisma/client/runtime/query_engine_bg.* \
            "$d"/@prisma/client/runtime/binary.* \
            "$d"/@prisma/client/runtime/edge* \
            "$d"/@prisma/client/runtime/wasm* \
            "$d"/@prisma/client/runtime/react-native* \
            "$d"/.prisma/client/query_engine_bg.* \
            "$d"/.prisma/client/wasm* "$d"/.prisma/client/edge*; \
    done; \
    rm -rf @img+sharp* sharp@*

# ---- ops: migrations, seed e criação de admin (one-shot) ----
# Não é a imagem que serve tráfego: carrega devDependencies (tsx) de propósito,
# para `prisma db seed` e `scripts/criar-admin.ts`. Sem o build do Next.
FROM deps AS ops
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
# `prisma db seed` chama `tsx` pelo PATH (package.json → prisma.seed).
ENV PATH=/app/node_modules/.bin:$PATH
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ---- runtime ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=standalone --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
