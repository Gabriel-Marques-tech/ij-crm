/**
 * Reprocessamento de MensagemBruta (GAB-41). Uma função só para o botão do
 * painel e para o cron: devolve a linha a `RECEBIDA` (MANTENDO `erro`, que faz
 * a resposta começar com "Reprocessada:") e chama `processarMensagem`, que
 * reivindica com cerca em `tentativas`. Dois cliques, cron + clique ou dois
 * crons caem no mesmo UPDATE condicional: só um chama a LLM, nunca dois cards.
 *
 * Contrato do cron (README "#crm → card", comentário do GAB-41):
 * - `RECEBIDA` parada há mais de 2 min = órfã (o processo morreu antes do
 *   `after()`); processa.
 * - `PROCESSANDO` há mais de 5 min volta a `RECEBIDA` — nunca antes (pior caso
 *   LLM 2×30 s + transação); a cerca derruba o worker antigo se ele acordar.
 * - `FALHA` com menos de 3 tentativas volta. `FALHA` por `SEM_CREDITO` volta
 *   sempre (é a recarga que resolve), mas a execução PARA no primeiro
 *   `SEM_CREDITO` de novo: no máximo uma chamada inútil a cada 10 min.
 * - No máximo `limite` (20) mensagens por execução e nada novo depois do
 *   `prazo` (o script do cron desiste em 300 s).
 */
import type { StatusMensagem } from "@prisma/client";
import { db } from "@/lib/db";
import { processarMensagem, type ResultadoProcessamento } from "./processar";

export const ORFA_MS = 2 * 60_000;
export const TRAVADA_MS = 5 * 60_000;
export const MAX_TENTATIVAS_FALHA = 3;
export const LIMITE_POR_EXECUCAO = 20;
export const PRAZO_EXECUCAO_MS = 4 * 60_000;
const CODIGO_SEM_CREDITO = "LLM_SEM_CREDITO";

export type ResultadoReprocessar = ResultadoProcessamento | { tipo: "NAO_REPROCESSAVEL" };

/**
 * Devolve a `RECEBIDA` se o status atual estiver em `de` e processa. `RECEBIDA`
 * em `de` = aceita a linha já recebida (órfã do cron). Qualquer outro status
 * (PROCESSADA, PROCESSANDO, inexistente) → `NAO_REPROCESSAVEL`, sem efeito.
 */
export async function reprocessarMensagem(id: string, de: StatusMensagem[]): Promise<ResultadoReprocessar> {
  const devolver = de.filter((s) => s !== "RECEBIDA" && s !== "PROCESSANDO" && s !== "PROCESSADA");
  const { count } = devolver.length
    ? await db.mensagemBruta.updateMany({ where: { id, status: { in: devolver } }, data: { status: "RECEBIDA" } })
    : { count: 0 };
  if (count === 0 && !de.includes("RECEBIDA")) return { tipo: "NAO_REPROCESSAVEL" };
  const r = await processarMensagem(id);
  return count === 0 && r.tipo === "IGNORADA" ? { tipo: "NAO_REPROCESSAVEL" } : r;
}

export type ContagemRetomada = {
  destravadas: number;
  tentadas: number;
  processadas: number;
  pendentes: number;
  descartadas: number;
  falhas: number;
  ignoradas: number;
  erros: number;
  /** Parou antes de esgotar a fila: ainda sem crédito, banco fora ou prazo. */
  interrompida: boolean;
};

export async function retomarPendentes(
  opts: { agora?: Date; limite?: number; prazo?: Date } = {},
): Promise<ContagemRetomada> {
  const agora = opts.agora ?? new Date();
  const limite = opts.limite ?? LIMITE_POR_EXECUCAO;
  const prazo = opts.prazo ?? new Date(Date.now() + PRAZO_EXECUCAO_MS);
  const c: ContagemRetomada = { destravadas: 0, tentadas: 0, processadas: 0, pendentes: 0, descartadas: 0, falhas: 0, ignoradas: 0, erros: 0, interrompida: false };

  // Não mexe em atualizado_em: a linha destravada já conta como órfã logo abaixo.
  c.destravadas = await db.$executeRaw`
    UPDATE mensagem_bruta SET status = 'RECEBIDA'
     WHERE status = 'PROCESSANDO' AND atualizado_em < ${new Date(agora.getTime() - TRAVADA_MS)}`;

  const candidatas = await db.$queryRaw<{ id: string; status: StatusMensagem }[]>`
    SELECT id, status::text AS status FROM mensagem_bruta
     WHERE (status = 'RECEBIDA' AND atualizado_em < ${new Date(agora.getTime() - ORFA_MS)})
        OR (status = 'FALHA' AND (tentativas < ${MAX_TENTATIVAS_FALHA}
                                  OR resultado_llm -> 'aplicacao' ->> 'codigo' = ${CODIGO_SEM_CREDITO}))
     ORDER BY recebida_em, id
     LIMIT ${limite}`;

  for (const m of candidatas) {
    if (Date.now() > prazo.getTime()) {
      c.interrompida = true;
      break;
    }
    c.tentadas++;
    const r = await reprocessarMensagem(m.id, [m.status]);
    if (r.tipo === "PROCESSADA") c.processadas++;
    else if (r.tipo === "PENDENTE_REVISAO") c.pendentes++;
    else if (r.tipo === "DESCARTADA") c.descartadas++;
    else if (r.tipo === "FALHA") c.falhas++;
    else if (r.tipo === "ERRO") c.erros++;
    else c.ignoradas++;
    // Ainda sem crédito, ou banco/config fora: o resto espera a próxima execução.
    if ((r.tipo === "FALHA" && r.codigo === CODIGO_SEM_CREDITO) || r.tipo === "ERRO") {
      c.interrompida = true;
      break;
    }
  }
  return c;
}
