import type { Instrumentation } from "next";

/** Toda falha não tratada no servidor vai ao log com ref = digest (ver src/lib/erros/requisicao.ts). */
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") return; // só Node: o registrador importa o Prisma
  const { registrarErroDeRequisicao } = await import("@/lib/erros/requisicao");
  registrarErroDeRequisicao(err, context);
};
