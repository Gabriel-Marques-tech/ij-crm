/**
 * Prazos (GAB-51), regras puras. A permissão é decidida no servidor
 * (`./prazos.ts` chama `podeMexerNoPrazo` em toda escrita): a UI só esconde.
 */
import type { Papel } from "@prisma/client";
import { podeEscrever, temPapelMinimo } from "@/lib/auth/papeis";
import { inicioDoDia } from "@/lib/oportunidades/campos";

export const TITULO_PRAZO_MAX = 200;

/**
 * Vendedor cria/edita/conclui/exclui só prazo em que é o responsável;
 * gestor/admin, de qualquer um; VISUALIZADOR, de nenhum (nem do próprio).
 */
export function podeMexerNoPrazo(ator: { id: string; papel: Papel }, responsavelId: string): boolean {
  if (!podeEscrever(ator.papel)) return false;
  return temPapelMinimo(ator.papel, "GESTOR") || ator.id === responsavelId;
}

export type PrazoValido = { ok: true; titulo: string; dia: string } | { ok: false; erro: string };

export function validarPrazo(tituloBruto: string, diaBruto: string): PrazoValido {
  const titulo = tituloBruto.trim();
  if (titulo === "" || titulo.length > TITULO_PRAZO_MAX) return { ok: false, erro: `Dê um nome ao prazo (até ${TITULO_PRAZO_MAX} caracteres).` };
  const dia = diaBruto.trim();
  if (dia === "") return { ok: false, erro: "Escolha o dia do prazo." };
  if (!inicioDoDia(dia)) return { ok: false, erro: "Data inválida." };
  return { ok: true, titulo, dia };
}

export type EstadoPrazo = "pendente" | "vencido" | "feito";

/** `hoje` em `YYYY-MM-DD` (SP). Vencido = dia antes de hoje e ainda não feito. */
export function estadoPrazo(p: { dia: string; feito: boolean }, hoje: string): EstadoPrazo {
  if (p.feito) return "feito";
  return p.dia < hoje ? "vencido" : "pendente";
}
