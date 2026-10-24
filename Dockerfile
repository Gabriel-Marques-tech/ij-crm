# syntax=docker/dockerfile:1

# ---- dev: used by compose.yml (source mounted as a volume) ----
FROM node:22-bookworm-slim AS dev
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- prod build stages land in GAB-30 (deploy ticket) ----
