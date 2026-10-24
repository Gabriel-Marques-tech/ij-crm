/**
 * Campos editáveis inline do card e a interpretação da string que vem do
 * formulário. Puro: o serviço grava, aqui só se decide o valor.
 */
import { Origem } from "@prisma/client";

export const CAMPOS_EDITAVEIS = [
  "titulo",
  "origem",
  "dor",
  "orcamentoPrevisto",
  "propostaUrl",
  "cidade",
  "estado",
  "responsavelId",
  "proximaAcao",
  "proximaAcaoEm",
  "revisar",
] as const;

export type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

export function ehCampoEditavel(c: string): c is CampoEditavel {
  return (CAMPOS_EDITAVEIS as readonly string[]).includes(c);
}

/** Valor já tipado para gravar. `orcamentoPrevisto` vai como string decimal ("12500.00"). */
export type ValorCampo = string | boolean | Date | null;

export type ResultadoCampo = { ok: true; valor: ValorCampo } | { ok: false; erro: string };

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const ROTULO_ORIGEM: Record<Origem, string> = {
  COLD_CALL: "Cold call",
  RD: "RD Station",
  INDICACAO: "Indicação",
  EVENTO: "Evento",
  OUTRO: "Outro",
};

export const ROTULO_CAMPO: Record<CampoEditavel, string> = {
  titulo: "Título",
  origem: "Origem",
  dor: "Dor",
  orcamentoPrevisto: "Orçamento previsto",
  propostaUrl: "Proposta",
  cidade: "Cidade",
  estado: "Estado",
  responsavelId: "Responsável",
  proximaAcao: "Próxima ação",
  proximaAcaoEm: "Data da próxima ação",
  revisar: "Revisar",
};

const TITULO_MAX = 200;

/** Título do card: aparado, espaços colapsados, 1..200 caracteres. */
export function validarTitulo(titulo: string): string | null {
  const t = titulo.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= TITULO_MAX ? t : null;
}

/**
 * `YYYY-MM-DD` → meia-noite em São Paulo. O Brasil não tem horário de verão
 * desde 2019, então o offset fixo -03:00 é exato.
 */
export function inicioDoDia(dia: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  const d = new Date(`${dia}T00:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejeita datas que o JS "rola" (30/02 → 02/03).
  const volta = new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return volta === dia ? d : null;
}

function textoOpcional(bruto: string, max: number, rotulo: string): ResultadoCampo {
  const t = bruto.trim();
  if (t === "") return { ok: true, valor: null };
  if (t.length > max) return { ok: false, erro: `${rotulo}: no máximo ${max} caracteres.` };
  return { ok: true, valor: t };
}

function dinheiro(bruto: string): ResultadoCampo {
  let t = bruto.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (t === "") return { ok: true, valor: null };
  // Formato BR (1.234,56): ponto é milhar, vírgula é decimal.
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return { ok: false, erro: "Orçamento inválido. Ex.: 12.500,00" };
  return { ok: true, valor: Number(t).toFixed(2) };
}

export function interpretarCampo(campo: CampoEditavel, bruto: string): ResultadoCampo {
  switch (campo) {
    case "titulo": {
      const t = validarTitulo(bruto);
      return t ? { ok: true, valor: t } : { ok: false, erro: `Título precisa ter entre 1 e ${TITULO_MAX} caracteres.` };
    }
    case "origem": {
      const t = bruto.trim();
      if (t === "") return { ok: true, valor: null };
      return t in Origem ? { ok: true, valor: t } : { ok: false, erro: "Origem inválida." };
    }
    case "dor":
      return textoOpcional(bruto, 5000, "Dor");
    case "proximaAcao":
      return textoOpcional(bruto, 500, "Próxima ação");
    case "cidade":
      return textoOpcional(bruto, 100, "Cidade");
    case "estado": {
      const t = bruto.trim().toUpperCase();
      if (t === "") return { ok: true, valor: null };
      return (UFS as readonly string[]).includes(t) ? { ok: true, valor: t } : { ok: false, erro: "Estado: use a sigla da UF (ex.: SP)." };
    }
    case "orcamentoPrevisto":
      return dinheiro(bruto);
    case "propostaUrl": {
      const t = bruto.trim();
      if (t === "") return { ok: true, valor: null };
      try {
        const u = new URL(t);
        if ((u.protocol === "http:" || u.protocol === "https:") && t.length <= 2000) return { ok: true, valor: t };
      } catch {
        /* cai no erro */
      }
      return { ok: false, erro: "Proposta: informe um link http(s) completo." };
    }
    case "responsavelId": {
      const t = bruto.trim();
      return t ? { ok: true, valor: t } : { ok: false, erro: "Escolha um responsável." };
    }
    case "proximaAcaoEm": {
      const t = bruto.trim();
      if (t === "") return { ok: true, valor: null };
      const d = inicioDoDia(t);
      return d ? { ok: true, valor: d } : { ok: false, erro: "Data inválida." };
    }
    case "revisar":
      if (bruto === "true") return { ok: true, valor: true };
      if (bruto === "false") return { ok: true, valor: false };
      return { ok: false, erro: "Valor inválido." };
  }
}
