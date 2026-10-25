/**
 * Regras puras de ganho/perdido (GAB-32), usadas pelo servidor (gancho em
 * `terminal.ts`) e pelos diálogos do Kanban. Sem banco e sem import de valor
 * do Prisma: roda no cliente também.
 */
import type { TipoTerminal } from "@prisma/client";

export const PIPELINE_VENDAS = "vendas";
export const PIPELINE_PROJETOS = "projetos";
/** Fase onde nasce o card de projeto. Achada pela chave, nunca pela posição (§4.2). */
export const FASE_INICIAL_PROJETOS = "em_execucao";

export const MOTIVOS_PERDA = [
  { chave: "preco", rotulo: "Preço" },
  { chave: "timing", rotulo: "Timing" },
  { chave: "concorrente", rotulo: "Concorrente" },
  { chave: "sem_resposta", rotulo: "Sem resposta" },
  { chave: "outro", rotulo: "Outro" },
] as const;

export type ChaveMotivoPerda = (typeof MOTIVOS_PERDA)[number]["chave"];

export const DETALHE_PERDA_MAX = 500;

/** O que o diálogo manda para `moverCard(..., { dadosTerminal })`: strings cruas do formulário. */
export type DadosTerminal = { valorFechado?: string; motivo?: string; detalhe?: string };

export type ErroDadosTerminal =
  | "DADOS_TERMINAL_OBRIGATORIOS"
  | "VALOR_FECHADO_INVALIDO"
  | "MOTIVO_PERDA_OBRIGATORIO"
  | "MOTIVO_PERDA_INVALIDO"
  | "MOTIVO_PERDA_DETALHE_OBRIGATORIO"
  | "MOTIVO_PERDA_DETALHE_LONGO";

/**
 * Dinheiro digitado → decimal com 2 casas ("12500.00"), ou null se vazio.
 * Formato BR estrito: "R$" opcional, ponto SÓ como milhar em grupos de 3
 * ("1.234", "12.500"), vírgula como decimal com 1–2 casas ("1.234,56", "1,5").
 * Ponto decimal ("1.23", "8000.75") e formato americano ("1,234.56") são
 * ambíguos e recusados. Também recusa negativo, notação científica e mais de
 * 12 dígitos inteiros (a coluna é Decimal(14,2)).
 */
export function lerDinheiro(bruto: string): { ok: true; valor: string | null } | { ok: false } {
  const t = bruto.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (t === "") return { ok: true, valor: null };
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false };
  const inteiro = m[1].replace(/\./g, "");
  if (inteiro.length > 12) return { ok: false };
  return { ok: true, valor: Number(`${inteiro}.${m[2] ?? "0"}`).toFixed(2) };
}

/**
 * Qual diálogo abrir ao mover para um terminal: ganho só pede dados em
 * vendas (valor fechado); perdido pede motivo em qualquer quadro. Terminal
 * sem diálogo (ex.: "Finalizado" em projetos) move direto.
 */
export function dialogoTerminal(pipelineChave: string, tipo: TipoTerminal | null): TipoTerminal | null {
  if (tipo === "PERDIDO") return "PERDIDO";
  if (tipo === "GANHO" && pipelineChave === PIPELINE_VENDAS) return "GANHO";
  return null;
}

/** Os dados do fechamento vêm como objeto (pode ser `{}`); ausente = ninguém passou pelo diálogo. */
function ehObjeto(dados: unknown): dados is Record<string, unknown> {
  return typeof dados === "object" && dados !== null && !Array.isArray(dados);
}

function campo(dados: Record<string, unknown>, nome: keyof DadosTerminal): unknown {
  return Object.hasOwn(dados, nome) ? dados[nome] : undefined;
}

/** Ganho em vendas: exige o objeto de dados (o servidor é a porta); valor fechado opcional. */
export function interpretarGanho(dados: unknown): { ok: true; valorFechado: string | null } | { ok: false; erro: ErroDadosTerminal } {
  if (!ehObjeto(dados)) return { ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" };
  const v = campo(dados, "valorFechado");
  if (v === undefined || v === null) return { ok: true, valorFechado: null };
  if (typeof v !== "string" || v.length > 50) return { ok: false, erro: "VALOR_FECHADO_INVALIDO" };
  const r = lerDinheiro(v);
  return r.ok ? { ok: true, valorFechado: r.valor } : { ok: false, erro: "VALOR_FECHADO_INVALIDO" };
}

/** Motivo → texto gravado em `motivo_perda`: "Preço" ou "Preço: detalhe"; "outro" exige detalhe. */
export function interpretarPerda(dados: unknown): { ok: true; motivoPerda: string } | { ok: false; erro: ErroDadosTerminal } {
  if (!ehObjeto(dados)) return { ok: false, erro: "DADOS_TERMINAL_OBRIGATORIOS" };
  const motivo = campo(dados, "motivo");
  if (motivo === undefined || motivo === null || motivo === "") return { ok: false, erro: "MOTIVO_PERDA_OBRIGATORIO" };
  // Compara com a lista (não `in`): chaves do protótipo não passam.
  const m = typeof motivo === "string" ? MOTIVOS_PERDA.find((x) => x.chave === motivo) : undefined;
  if (!m) return { ok: false, erro: "MOTIVO_PERDA_INVALIDO" };
  const bruto = campo(dados, "detalhe");
  if (bruto !== undefined && bruto !== null && typeof bruto !== "string") return { ok: false, erro: "MOTIVO_PERDA_INVALIDO" };
  const detalhe = (bruto ?? "").trim().replace(/\s+/g, " ");
  if (detalhe.length > DETALHE_PERDA_MAX) return { ok: false, erro: "MOTIVO_PERDA_DETALHE_LONGO" };
  if (m.chave === "outro" && detalhe === "") return { ok: false, erro: "MOTIVO_PERDA_DETALHE_OBRIGATORIO" };
  return { ok: true, motivoPerda: detalhe ? `${m.rotulo}: ${detalhe}` : m.rotulo };
}

const DECIMAL_BR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor guardado ("10000.00") → texto do campo do diálogo ("10.000,00"); `lerDinheiro` lê de volta. */
export function valorParaCampo(valor: string | null): string {
  if (valor === null || valor === "") return "";
  const n = Number(valor);
  return Number.isFinite(n) ? DECIMAL_BR.format(n).replace(/\s/g, "") : "";
}

/**
 * `motivo_perda` gravado → seleção do diálogo (pré-preenche a re-perda). Inverso
 * de `interpretarPerda`; texto que não começa por um rótulo da lista (ex.: vindo
 * do import) vira "outro" com o texto como detalhe.
 */
export function motivoDeTexto(texto: string | null): { motivo: ChaveMotivoPerda | ""; detalhe: string } {
  if (!texto) return { motivo: "", detalhe: "" };
  for (const m of MOTIVOS_PERDA) {
    if (texto === m.rotulo) return { motivo: m.chave, detalhe: "" };
    if (texto.startsWith(`${m.rotulo}: `)) return { motivo: m.chave, detalhe: texto.slice(m.rotulo.length + 2) };
  }
  return { motivo: "outro", detalhe: texto };
}

export type AlertaVenda = "reaberta" | "perdida" | "removida";

/**
 * Aviso do card de PROJETO enquanto a venda de origem não está em ganho
 * (reaberta, perdida ou removida). O projeto nunca é movido/apagado sozinho:
 * o aviso é para alguém decidir. Card sem venda de origem → null.
 */
export function alertaDaVenda(origem: { deletadoEm: Date | null; fase: { tipoTerminal: TipoTerminal | null } } | null): AlertaVenda | null {
  if (!origem) return null;
  if (origem.deletadoEm) return "removida";
  if (origem.fase.tipoTerminal === "GANHO") return null;
  return origem.fase.tipoTerminal === "PERDIDO" ? "perdida" : "reaberta";
}

export const ROTULO_ALERTA_VENDA: Record<AlertaVenda, string> = {
  reaberta: "venda reaberta",
  perdida: "venda perdida",
  removida: "venda removida",
};
