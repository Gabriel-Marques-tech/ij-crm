/**
 * Smoke do provedor de LLM configurado (LLM_PROVEDOR + chave + modelo do env):
 * uma chamada por schema (extração, classificação, resumo) com mensagem
 * sintética. Imprime só status, tokens e ms; sai ≠ 0 se alguma falhar.
 *
 *   pnpm llm:smoke                                   (dev, com o .env local)
 *   dc --profile ops run --rm llm-smoke               (produção, runbook §10)
 *
 * Lê só o env (não a config salva no Admin): para testar outro provedor sem
 * mexer no .env, passe por cima, ex.: `-e LLM_PROVEDOR=gemini`.
 */
import { rodarSmokeLlm } from "../src/lib/llm/smoke";

rodarSmokeLlm().then(
  (ok) => {
    console.log(ok ? "[llm-smoke] ok" : "[llm-smoke] FALHOU");
    process.exit(ok ? 0 : 1);
  },
  (e: unknown) => {
    console.error(`[llm-smoke] FALHOU (${e instanceof Error ? e.name : typeof e})`);
    process.exit(1);
  },
);
