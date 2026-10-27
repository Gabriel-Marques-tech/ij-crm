import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Fora do app: worktrees de agentes e saídas de ferramentas locais.
    ".claude/**",
    ".code-review-graph/**",
    "graphify-out/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
