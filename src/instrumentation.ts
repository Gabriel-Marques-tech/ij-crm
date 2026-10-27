import type { Instrumentation } from "next";

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
