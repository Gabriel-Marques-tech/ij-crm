import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Não gerar AGENTS.md automático no dev (o contexto do projeto vive no design doc / README).
  agentRules: false,
  // Imagem de produção (Dockerfile, estágio `runtime`) roda só o server.js
  // rastreado + node_modules mínimo, sem pnpm nem devDependencies (GAB-30).
  output: "standalone",
  // Upload do CSV do Pipefy (GAB-37) vai por server action: o padrão é 1 MB.
  // O serviço recusa acima de 8 MB com mensagem própria (LIMITE_BYTES).
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  // App inteiro é autenticado (cookie lido no layout) → tudo é dinâmico por
  // natureza; cacheComponents/PPR não trazem ganho aqui e exigem Suspense em
  // cada rota. Reavaliar se surgir página pública pesada.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
