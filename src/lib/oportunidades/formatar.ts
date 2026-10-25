/** Formatação pura de valores do card para exibição (detalhe e Timeline). */
import type { Origem } from "@prisma/client";
import { FUSO_NEGOCIO } from "./aging";
import { ROTULO_ORIGEM, type CampoEditavel } from "./campos";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_NEGOCIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatarDinheiro(v: string | number): string {
  // Intl usa espaço não separável depois de "R$"; normaliza para espaço comum.
  return BRL.format(Number(v)).replace(/ /g, " ");
}

export function formatarDataHora(d: Date): string {
  return DATA_HORA.format(d).replace(",", "");
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
export function formatarDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** Valor serializado (como na Timeline `CAMPO_ALTERADO`) → texto. */
export function formatarValorCampo(campo: CampoEditavel, v: unknown, nomes: ReadonlyMap<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (campo) {
    case "orcamentoPrevisto":
      return formatarDinheiro(String(v));
    case "revisar":
      return v === true ? "sim" : "não";
    case "origem":
      return ROTULO_ORIGEM[v as Origem] ?? String(v);
    case "proximaAcaoEm":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatarDia(String(v)) : String(v);
    case "responsavelId":
      return nomes.get(String(v)) ?? "usuário removido";
    default:
      return String(v);
  }
}
