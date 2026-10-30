/**
 * Resumo da janela de 12 h ANTERIOR por vendedor (GAB-49) — contexto da
 * extração junto com o ledger da janela atual (`ledger.ts`).
 *
 * - Fora do caminho da mensagem: a extração só LÊ o resumo pronto
 *   (`lerResumoJanelaAnterior`); ausente ou `GERANDO` → segue sem ele.
 *   `processarMensagem` dispara `gerarResumoJanelaAnterior` em paralelo, sem
 *   esperar, e só aguarda no fim (ainda dentro do `after()` do webhook); o
 *   cron do GAB-41 pode adiantar com `gerarResumosPendentes()`.
 * - Fotografia completa: só gera quando a janela não tem mensagem do
 *   vendedor em voo (`RECEBIDA`/`PROCESSANDO`); senão fica para um gatilho
 *   seguinte.
 * - Idempotente e sem corrida: chave única `(usuario_id, janela_inicio)` +
 *   reivindicação. Quem cria a linha `GERANDO` (INSERT … ON CONFLICT DO
 *   NOTHING) ou re-reivindica uma `FALHA` / `GERANDO` abandonada (> 5 min),
 *   sempre com menos de 3 tentativas, chama a LLM; o outro desiste na hora.
 *   A gravação do resultado é cercada por `tentativas`.
 * - Nunca lança: falha → `FALHA` com código + ref (`registrarErro`, sem texto).
 * - Retenção: só o resumo da janela anterior à atual fica; os mais antigos
 *   são apagados no começo de cada geração e por `aplicarRetencaoResumos`
 *   (cron), pelo índice de `janela_inicio`. O ledger não é copiado para lugar
 *   nenhum: o texto original segue a regra de 90 dias da `mensagem_bruta`.
 */
import { carregarConfigTecnica } from "@/lib/config/tecnica";
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

/** Resumo PRONTO da janela anterior a `agora`, sem gerar. `null` se ausente/GERANDO/FALHA. Nunca lança. */
export async function lerResumoJanelaAnterior(usuarioId: string, agora: Date = new Date()): Promise<string | null> {
  try {
    const r = await db.resumoJanela.findUnique({
      where: { usuarioId_janelaInicio: { usuarioId, janelaInicio: janelaAnterior(agora).inicio } },
      select: { status: true, texto: true },
    });
    return r?.status === "PRONTO" ? r.texto : null;
  } catch (e) {
    registrarErro("contexto-resumo", erroSeguro(e));
    return null;
  }
}

/**
 * Gera (se preciso) o resumo da janela anterior a `agora` e devolve o texto.
 * `null` = sem vendas naquela janela, mensagem ainda em voo, outro worker
 * gerando, tentativas esgotadas ou falha (já registrada). Nunca lança.
 */
export async function gerarResumoJanelaAnterior(usuarioId: string, agora: Date = new Date()): Promise<string | null> {
  return (await garantir(usuarioId, agora)).texto;
}

async function garantir(usuarioId: string, agora: Date): Promise<Garantido> {
  const janela = janelaAnterior(agora);
  try {
    await aplicarRetencaoResumos(agora);
    const existente = await db.resumoJanela.findUnique({
      where: { usuarioId_janelaInicio: { usuarioId, janelaInicio: janela.inicio } },
      select: { status: true, texto: true },
    });
    if (existente?.status === "PRONTO") return { texto: existente.texto, gerado: false };

    const emVoo = await db.mensagemBruta.count({
      where: { remetenteUsuarioId: usuarioId, recebidaEm: { gte: janela.inicio, lt: janela.fim }, status: { in: ["RECEBIDA", "PROCESSANDO"] } },
    });
    if (emVoo > 0) return { texto: null, gerado: false };

    const ledger = await ledgerDaJanela({ usuarioId, janela });
    if (ledger.length === 0) return { texto: null, gerado: false };

    const reivindicada = await reivindicar(usuarioId, janela);
    if (!reivindicada) return { texto: null, gerado: false };
    return await gerar(reivindicada, usuarioId, janela, ledger);
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
        tentativas: { lt: MAX_TENTATIVAS_RESUMO },
        OR: [{ status: "FALHA" }, { status: "GERANDO", atualizadoEm: { lt: new Date(agora.getTime() - GERANDO_ABANDONADO_MS) } }],
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
): Promise<Garantido> {
  const cerca = { id: linha.id, status: "GERANDO" as const, tentativas: linha.tentativas };
  try {
    const [usuario, cards] = await Promise.all([
      db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } }),
      db.projeto.findMany({ where: { id: { in: cardsDoLedger(ledger, MAX_CARDS_RESUMO) } }, select: { titulo: true, fase: { select: { nome: true } } } }),
    ]);
    const r = await resumirJanela(
      { vendedor: usuario?.nome ?? "vendedor", mensagens: ledger, cards: cards.map((c) => ({ titulo: c.titulo, fase: c.fase.nome })) },
      { ref: linha.id },
    );
    const { count } = await db.resumoJanela.updateMany({ where: cerca, data: { status: "PRONTO", texto: r.resumo, erro: null, atualizadoEm: new Date() } });
    if (count === 0) return { texto: null, gerado: false };
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

/** Teto de tempo de uma rodada do cron: o que sobrar fica para a próxima. */
export const PRAZO_RESUMOS_PENDENTES_MS = 2 * 60 * 1000;

/**
 * Para o cron (GAB-41): gera o resumo da janela anterior de cada vendedor
 * que mandou venda nela (em série — ≤15 vendedores), com prazo total
 * (`prazoMs`, padrão 2 min, checado entre um vendedor e outro; pelo menos um
 * por rodada), e aplica a
 * retenção. Nunca lança.
 */
export async function gerarResumosPendentes(
  agora: Date = new Date(),
  opts: { prazoMs?: number } = {},
): Promise<{ gerados: number; interrompido: boolean }> {
  const inicio = Date.now();
  const prazo = opts.prazoMs ?? PRAZO_RESUMOS_PENDENTES_MS;
  let gerados = 0;
  let interrompido = false;
  try {
    // GAB-42: provedor/modelo/chave da config do Admin (o webhook já carrega; o cron não).
    const carga = await carregarConfigTecnica();
    if (!carga.ok) return { gerados, interrompido };
    await aplicarRetencaoResumos(agora);
    const janela = janelaAnterior(agora);
    // Índice `mensagem_bruta(recebida_em)`.
    const remetentes = await db.mensagemBruta.findMany({
      where: { recebidaEm: { gte: janela.inicio, lt: janela.fim }, status: { not: "CLASSIFICADA_IRRELEVANTE" }, remetenteUsuarioId: { not: null } },
      distinct: ["remetenteUsuarioId"],
      select: { remetenteUsuarioId: true },
    });
    for (const [i, r] of remetentes.entries()) {
      // Pelo menos um por rodada (progresso garantido); depois, respeita o prazo.
      if (i > 0 && Date.now() - inicio >= prazo) {
        interrompido = true;
        break;
      }
      if ((await garantir(r.remetenteUsuarioId!, agora)).gerado) gerados++;
    }
  } catch (e) {
    registrarErro("contexto-resumo", erroSeguro(e));
  }
  return { gerados, interrompido };
}
