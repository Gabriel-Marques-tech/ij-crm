/**
 * Regras puras da execução do Projeto (GAB-95, spec fase 2 §4.10/§4.12). Sem
 * banco: rodam na tela também.
 *
 * Quem opera (marcar entrega, ajustar data, lançar entrega, check-in) é decidido só
 * aqui, em `podeOperarExecucao`, e o serviço aplica em `recusaDeExecucao`:
 * - GP do projeto: o designado no handoff, enquanto valer (ativo e da área projetos).
 *   Sem GP válido (card isento, migrado, GP que saiu), responde o responsável do card.
 * - Apoio: ADMIN e GESTOR da área, que é o gestor de projetos ou o sem área (conta nas duas).
 * - O resto lê: a tela e `ver_cronograma` não restringem leitura.
 * Mudar só o campo Responsável não troca o GP: quem troca o GP é o PM de projetos, designando
 * outro (`designarGpDoProjeto`). O Responsável é trocado pelo responsável atual, pelo GP da área
 * dona ou pela gestão da área (`podeTrocarResponsavel`), regra que não fala de execução.
 */
import type { StatusCheckin } from "@prisma/client";
import { ladoDe, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever } from "@/lib/auth/papeis";
import { podeSerGpDoProjeto } from "./handoff-regras";

export const STATUS_CHECKIN = ["VERDE", "AMARELO", "VERMELHO"] as const satisfies readonly StatusCheckin[];

export const ROTULO_CHECKIN: Record<StatusCheckin, string> = { VERDE: "Verde", AMARELO: "Amarelo", VERMELHO: "Vermelho" };

/** "Uma linha de motivo" (spec §4.10). */
export const MOTIVO_MAX = 300;

/** Normaliza para uma linha. null = vazio ou comprido demais. */
export function lerMotivo(bruto: string): string | null {
  const t = bruto.replace(/\s+/g, " ").trim();
  return t && t.length <= MOTIVO_MAX ? t : null;
}

/** Dia aceito em cronograma: barra ano digitado errado (0202, 20026). `dia` já é um dia real. */
export function diaNoIntervalo(dia: string): boolean {
  return dia >= "2000-01-01" && dia <= "2100-12-31";
}

type GpGravado = (PessoaComLado & { id: string; ativo: boolean }) | null | undefined;

/** Id de quem responde pela execução: o GP designado que ainda vale ou o responsável. */
export function gpDoProjeto(card: { responsavelId: string; gpDesignado: GpGravado }): string {
  const gp = card.gpDesignado;
  return gp && podeSerGpDoProjeto(gp) ? gp.id : card.responsavelId;
}

/** A pessoa pode operar a execução deste Projeto? O único lugar que responde isso. */
export function podeOperarExecucao(p: PessoaComLado & { id: string; ativo: boolean }, gpId: string): boolean {
  if (!p.ativo || !podeEscrever(p.papel)) return false;
  if (p.papel === "ADMIN") return true;
  if (p.papel === "GESTOR" && ladoDe(p) !== "VENDAS") return true;
  return p.id === gpId;
}
