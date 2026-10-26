/**
 * Mapeamento fase do Pipefy → fase do CRM e responsável → usuário (GAB-37). Puro.
 *
 * Padrão: nome normalizado igual (sem acento/caixa/pontuação) ao nome ou à
 * chave de uma fase ATIVA do CRM — o seed espelha o pipe do Pipefy, então as
 * fases da IJ casam sozinhas. O gestor corrige na prévia (fase renomeada,
 * fase antiga → "ignorar" ou outra fase). Vendas tem prioridade num empate.
 *
 * O pipe do Pipefy é um só; o CRM o divide em Vendas e Projetos. Card numa
 * fase de Projetos (ex.: "Em execução") é uma venda ganha cujo projeto já
 * andou: a venda entra em ganho e o projeto vai para aquela fase.
 */
import type { TipoTerminal } from "@prisma/client";
import type { FasePipefy } from "./interpretar";
import { normalizarTexto } from "./valores";
import { normalizarEmail } from "@/lib/normalizacao";

export type FaseCrm = {
  id: string;
  chave: string;
  nome: string;
  pipelineChave: string;
  pipelineNome: string;
  tipoTerminal: TipoTerminal | null;
};

/** chave da fase do Pipefy (`chaveFasePipefy`) → id da fase do CRM; null = ignorar. */
export type Mapeamento = Record<string, string | null>;

export function mapeamentoPadrao(fasesPipefy: FasePipefy[], fasesCrm: FaseCrm[]): Mapeamento {
  const ordenadas = [...fasesCrm].sort((a, b) => (a.pipelineChave === "vendas" ? 0 : 1) - (b.pipelineChave === "vendas" ? 0 : 1));
  const m: Mapeamento = {};
  for (const f of fasesPipefy) {
    const achada = ordenadas.find((c) => normalizarTexto(c.nome) === f.chave || normalizarTexto(c.chave) === f.chave);
    m[f.chave] = achada?.id ?? null;
  }
  return m;
}

/**
 * Mapeamento vindo do cliente/CLI: só chaves que existem no arquivo, valores
 * = id de fase ativa ou null. Chave ausente → null (ignorar).
 */
export function validarMapeamento(bruto: unknown, fasesPipefy: FasePipefy[], fasesCrm: FaseCrm[]): { ok: true; mapeamento: Mapeamento } | { ok: false; erro: string } {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { ok: false, erro: "Mapeamento de fases inválido." };
  const ids = new Set(fasesCrm.map((f) => f.id));
  const chaves = new Set(fasesPipefy.map((f) => f.chave));
  const entrada = bruto as Record<string, unknown>;
  for (const k of Object.keys(entrada)) {
    if (!chaves.has(k)) return { ok: false, erro: `Fase "${k}" não está no arquivo.` };
  }
  const m: Mapeamento = {};
  for (const f of fasesPipefy) {
    const v = Object.hasOwn(entrada, f.chave) ? entrada[f.chave] : null;
    if (v === null || v === "") m[f.chave] = null;
    else if (typeof v === "string" && ids.has(v)) m[f.chave] = v;
    else return { ok: false, erro: `Fase do CRM inválida para "${f.nome}". Recarregue a prévia.` };
  }
  return { ok: true, mapeamento: m };
}

/** JSON com chaves ordenadas: o mesmo mapeamento sempre dá o mesmo hash. */
export function canonico(m: Mapeamento): string {
  return JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
}

export type UsuarioCrm = { id: string; nome: string; email: string };

/**
 * Responsável do Pipefy → usuário ATIVO do CRM: email exato ou nome
 * normalizado exato e único (dois "Ana Souza" → sem match). Nunca aproximado.
 */
export function resolverResponsavel(nome: string | null, usuarios: UsuarioCrm[]): UsuarioCrm | null {
  if (!nome) return null;
  const email = nome.includes("@") ? normalizarEmail(nome) : null;
  if (email) return usuarios.find((u) => u.email.toLowerCase() === email) ?? null;
  const n = normalizarTexto(nome);
  const iguais = usuarios.filter((u) => normalizarTexto(u.nome) === n);
  return iguais.length === 1 ? iguais[0] : null;
}
