import type { Instrumentation } from "next";

/**
 * Boot (GAB-39): avisa uma vez se LLM_LIMIAR_* / LLM_CLASSIFICACAO_MODELO estiverem errados.
 * GAB-42: carrega antes a config técnica do Admin (sobrescreve o env), para os
 * valores salvos lá também passarem pela validação. No build não há banco.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { carregarConfigTecnica } = await import("@/lib/config/tecnica");
    await carregarConfigTecnica(); // nunca lança: banco fora → log com ref, vale o env
  }
  const { validarConfigLlm } = await import("@/lib/config/env");
  validarConfigLlm();
}

/**
 * Toda falha não tratada no servidor vai ao log com ref = digest (ver
 * src/lib/erros/requisicao.ts). Se o próprio registro falhar, ainda sai a
 * linha mínima com a ref: a ref da tela sempre acha algo no log.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") return; // só Node: o registrador importa o Prisma
  try {
    const { registrarErroDeRequisicao } = await import("@/lib/erros/requisicao");
    registrarErroDeRequisicao(err, context);
  } catch {
    const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "?";
    console.error(`[${context.routeType} ${context.routePath}] ref=${digest}`);
  }
};
