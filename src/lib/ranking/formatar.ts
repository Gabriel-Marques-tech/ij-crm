/** Formatação dos números do ranking (GAB-44). Sem dado → "—". */
import { formatarDinheiro } from "@/lib/projetos/formatar";
import type { Destaque } from "./calculo";

export const TRACO = "—";

const INTEIRO = new Intl.NumberFormat("pt-BR");
const DIAS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function fmtInteiro(n: number): string {
  return INTEIRO.format(n);
}

export function fmtDinheiro(n: number | null): string {
  return n === null ? TRACO : formatarDinheiro(n);
}

export function fmtPercentual(r: number | null): string {
  return r === null ? TRACO : `${Math.round(r * 100)}%`;
}

export function fmtDias(d: number | null): string {
  if (d === null) return TRACO;
  return d < 1 ? "< 1 dia" : `${DIAS.format(d)} ${d < 2 ? "dia" : "dias"}`;
}

export function fmtDestaque(formato: Destaque["formato"], v: number | null): string {
  switch (formato) {
    case "dinheiro":
      return fmtDinheiro(v);
    case "percentual":
      return fmtPercentual(v);
    case "dias":
      return fmtDias(v);
    default:
      return v === null ? TRACO : fmtInteiro(v);
  }
}

export function plural(n: number, um: string, varios: string): string {
  return `${fmtInteiro(n)} ${n === 1 ? um : varios}`;
}
