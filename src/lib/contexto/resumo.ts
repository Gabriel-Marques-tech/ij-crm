/**
 * Resumo da janela de 12 h ANTERIOR por vendedor (GAB-49) — contexto da
 * extração junto com o ledger da janela atual (`ledger.ts`).
 *
 * - Sob demanda: a 1ª mensagem do vendedor na janela seguinte chama
 *   `resumoJanelaAnterior` (de `montarContexto`, fora de transação). O cron do
 *   GAB-41 pode adiantar com `gerarResumosPendentes()`.
 * - Idempotente e sem corrida: chave única `(usuario_id, janela_inicio)` +
 *   reivindicação. Quem cria a linha `GERANDO` (INSERT … ON CONFLICT DO
 *   NOTHING) ou re-reivindica uma `FALHA` (< 3 tentativas) / `GERANDO`
 *   abandonada (> 5 min) chama a LLM; o outro segue SEM resumo, sem esperar.
 *   A gravação do resultado é cercada por `tentativas`.
 * - Nunca lança e nunca bloqueia o pipeline: falha → `FALHA` com código + ref
 *   (`registrarErro`, sem texto) e a extração segue só com o ledger.
 * - Retenção: só o resumo da janela anterior à atual fica; os mais antigos
 *   são apagados ao gerar um novo e por `aplicarRetencaoResumos` (cron). O
 *   ledger não é copiado para lugar nenhum: o texto original segue a regra
 *   de 90 dias da `mensagem_bruta` (GAB-41).
 */
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { resumirJanela } from "@/lib/llm/resumo";
import { ErroLlm } from "@/lib/llm/tipos";
import { erroSeguro } from "@/lib/whatsapp/erro-seguro";
import { janelaAnterior, type Janela } from "./janela";
import { cardsDoLedger, ledgerDaJanela } from "./ledger";

export const MAX_TENTATIVAS_RESUMO = 3;
/** `GERANDO` mais velho que isso = processo morreu no meio (LLM 2×30 s de pior caso). */
export const GERANDO_ABANDONADO_MS = 5 * 60 * 1000;
const MAX_CARDS_RESUMO = 20;

type Garantido = { texto: string | null; gerado: boolean };

/**
 * Texto do resumo da janela anterior a `agora` para o vendedor, gerando se
 * preciso. `null` = sem vendas naquela janela, outro worker gerando, ou
 * falha (já registrada). Nunca lança.
 */
export async function resumoJanelaAnterior(usuarioId: string, agora: Date = new Date()): Promise<string | null> {
  return (await garantir(usuarioId, agora)).texto;
}

async function garantir(usuarioId: string, agora: Date): Promise<Garantido> {
  const janela = janelaAnterior(agora);
  try {
    const existente = await db.resumoJanela.findUnique({
      where: { usuarioId_janelaInicio: { usuarioId, janelaInicio: janela.inicio } },
      select: { status: true, texto: true },
    });
    if (existente?.status === "PRONTO") return { texto: existente.texto, gerado: false };

    const ledger = await ledgerDaJanela({ usuarioId, janela });
    if (ledger.length === 0) return { texto: null, gerado: false };

    const reivindicada = await reivindicar(usuarioId, janela);
    if (!reivindicada) return { texto: null, gerado: false };
    return await gerar(reivindicada, usuarioId, janela, ledger, agora);
  } catch (e) {
    registrarErro("contexto-resumo", erroSeguro(e));
    return { texto: null, gerado: false };
  }
}

/** Reivindica a linha (nova, FALHA re-tentável ou GERANDO abandonada). */
async function reivindicar(usuarioId: string, janela: Janela): Promise<{ id: string; tentativas: number } | null> {
  const agora = new Date();
  const criadas = await db.resumoJanela.createMany({
    data: [{ usuarioId, janelaInicio: janela.inicio, status: "GERANDO", tentativas: 1, atualizadoEm: agora }],
    skipDuplicates: true,
  });
  const chave = { usuarioId, janelaInicio: janela.inicio };
  if (criadas.count === 0) {
    const { count } = await db.resumoJanela.updateMany({
      where: {
        ...chave,
        OR: [
          { status: "FALHA", tentativas: { lt: MAX_TENTATIVAS_RESUMO } },
          { status: "GERANDO", atualizadoEm: { lt: new Date(agora.getTime() - GERANDO_ABANDONADO_MS) } },
        ],
      },
      data: { status: "GERANDO", tentativas: { increment: 1 }, erro: null, atualizadoEm: agora },
    });
    if (count === 0) return null;
  }
  return db.resumoJanela.findUnique({ where: { usuarioId_janelaInicio: chave }, select: { id: true, tentativas: true } });
}

async function gerar(
  linha: { id: string; tentativas: number },
  usuarioId: string,
  janela: Janela,
  ledger: Awaited<ReturnType<typeof ledgerDaJanela>>,
  agora: Date,
): Promise<Garantido> {
  const cerca = { id: linha.id, status: "GERANDO" as const, tentativas: linha.tentativas };
  try {
    const [usuario, cards] = await Promise.all([
      db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } }),
      db.oportunidade.findMany({ where: { id: { in: cardsDoLedger(ledger, MAX_CARDS_RESUMO) } }, select: { titulo: true, fase: { select: { nome: true } } } }),
    ]);
    const r = await resumirJanela(
      { vendedor: usuario?.nome ?? "vendedor", mensagens: ledger, cards: cards.map((c) => ({ titulo: c.titulo, fase: c.fase.nome })) },
      { ref: linha.id },
    );
    const { count } = await db.resumoJanela.updateMany({ where: cerca, data: { status: "PRONTO", texto: r.resumo, erro: null, atualizadoEm: new Date() } });
    if (count === 0) return { texto: null, gerado: false };
    await aplicarRetencaoResumos(agora);
    return { texto: r.resumo, gerado: true };
  } catch (e) {
    const ref = registrarErro("contexto-resumo", erroSeguro(e));
    const codigo = e instanceof ErroLlm ? `LLM_${e.codigo}` : "INESPERADO";
    await db.resumoJanela.updateMany({ where: cerca, data: { status: "FALHA", erro: `${codigo} ref=${ref}`, atualizadoEm: new Date() } });
    console.info(`[contexto] resumo janela=${janela.inicio.toISOString()} falhou ref=${ref}; extração segue sem resumo`);
    return { texto: null, gerado: false };
  }
}

/** Apaga resumos de janelas mais antigas que a anterior a `agora`. Devolve quantos. */
export async function aplicarRetencaoResumos(agora: Date = new Date()): Promise<number> {
  const { count } = await db.resumoJanela.deleteMany({ where: { janelaInicio: { lt: janelaAnterior(agora).inicio } } });
  return count;
}

/**
 * Para o cron (GAB-41): gera o resumo da janela anterior de cada vendedor
 * que mandou venda nela (em série — ≤15 vendedores) e aplica a retenção.
 * Nunca lança.
 */
export async function gerarResumosPendentes(agora: Date = new Date()): Promise<{ gerados: number }> {
  let gerados = 0;
  try {
    const janela = janelaAnterior(agora);
    const remetentes = await db.mensagemBruta.findMany({
      where: { recebidaEm: { gte: janela.inicio, lt: janela.fim }, status: { not: "CLASSIFICADA_IRRELEVANTE" }, remetenteUsuarioId: { not: null } },
      distinct: ["remetenteUsuarioId"],
      select: { remetenteUsuarioId: true },
    });
    for (const r of remetentes) if ((await garantir(r.remetenteUsuarioId!, agora)).gerado) gerados++;
    await aplicarRetencaoResumos(agora);
  } catch (e) {
    registrarErro("contexto-resumo", erroSeguro(e));
  }
  return { gerados };
}
