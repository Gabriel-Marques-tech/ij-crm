# syntax=docker/dockerfile:1

# ---- dev: used by compose.yml (source mounted as a volume) ----
FROM node:22-bookworm-slim AS dev
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
# Roda como `node` (uid 1000) em vez de root: arquivos que o `next dev` escreve no
# bind mount (next-env.d.ts, tsbuildinfo) ficam editáveis pelo usuário do host.
# Os diretórios abaixo precisam existir com dono `node` ANTES do volume nomeado
# ser montado — o Docker copia a ownership para o volume novo.
RUN mkdir -p /app/node_modules /app/.next && chown -R node:node /app
USER node
ENV NEXT_TELEMETRY_DISABLED=1 \
    HOME=/home/node
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- prod build stages land in GAB-30 (deploy ticket) ----
