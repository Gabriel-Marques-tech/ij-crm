import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Não gerar AGENTS.md automático no dev (o contexto do projeto vive no design doc / README).
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
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
