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
  | "VALOR_FECHADO_INVALIDO"
  | "MOTIVO_PERDA_OBRIGATORIO"
  | "MOTIVO_PERDA_INVALIDO"
  | "MOTIVO_PERDA_DETALHE_OBRIGATORIO"
  | "MOTIVO_PERDA_DETALHE_LONGO";

/**
 * Dinheiro digitado → decimal com 2 casas ("12500.00"), ou null se vazio.
 * Aceita "R$", formato BR (1.234,56 e 12.500) e ponto decimal (1234.56).
 * Recusa negativo, notação científica, mais de 2 casas e mais de 12 dígitos
 * inteiros (a coluna é Decimal(14,2)).
 */
export function lerDinheiro(bruto: string): { ok: true; valor: string | null } | { ok: false } {
  let t = bruto.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (t === "") return { ok: true, valor: null };
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  // Sem vírgula e com grupos de 3 depois do ponto: é milhar BR ("12.500").
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return { ok: false };
  return { ok: true, valor: Number(t).toFixed(2) };
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

function campo(dados: unknown, nome: keyof DadosTerminal): unknown {
  return dados && typeof dados === "object" ? (dados as Record<string, unknown>)[nome] : undefined;
}

export function interpretarGanho(dados: unknown): { ok: true; valorFechado: string | null } | { ok: false; erro: ErroDadosTerminal } {
  const v = campo(dados, "valorFechado");
  if (v === undefined || v === null) return { ok: true, valorFechado: null };
  if (typeof v !== "string" || v.length > 50) return { ok: false, erro: "VALOR_FECHADO_INVALIDO" };
  const r = lerDinheiro(v);
  return r.ok ? { ok: true, valorFechado: r.valor } : { ok: false, erro: "VALOR_FECHADO_INVALIDO" };
}

/** Motivo → texto gravado em `motivo_perda`: "Preço" ou "Preço: detalhe"; "outro" exige detalhe. */
export function interpretarPerda(dados: unknown): { ok: true; motivoPerda: string } | { ok: false; erro: ErroDadosTerminal } {
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
