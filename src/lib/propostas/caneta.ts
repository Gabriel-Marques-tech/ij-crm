/**
 * Caneta e pingue-pongue da proposta (GAB-87, spec fase 2 §4.3/§4.12). Regras
 * PURAS — a máquina de estados que a tela, as server actions e o MCP seguem;
 * o serviço (`propostas.ts`) aplica estas mesmas funções DENTRO da transação,
 * com o usuário relido do banco.
 *
 * - Só o dono da caneta edita (e o Claude dele via MCP, que age como ele); o
 *   resto lê/comenta. Dono = `canetaComId`, ativo, que escreve e que ainda é
 *   do lado da caneta (mudou de lado na Gestão → perde na hora).
 * - A caneta só troca de mão quando o dono passa: `passar` (mesmo lado) ou
 *   `devolver` (outro lado, salvando versão). Exceção: o GP do lado da caneta
 *   pode `pegar` para destravar. Gestão sem lado não age na caneta.
 * - `concordar` só se a última versão veio do OUTRO lado → consenso = Pronta
 *   para envio. Ninguém chega lá sem os dois lados verem a última versão.
 * - `reabrir`: pronta → em ajuste (vendas quer mexer antes de enviar).
 * - `inviavel`: PM de projetos ou o dono da caneta do lado projetos.
 * - Enviada (GAB-89): só passar/pegar; envio e resposta do cliente seguem
 *   `./envio.ts`.
 *
 * Sem banco e sem import de valor do Prisma: roda no cliente também.
 */
import type { Area, StatusProposta } from "@prisma/client";
import { ehGpDoLado, ladoDe, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever } from "@/lib/auth/papeis";
import type { ErroProposta } from "./regras";

export type Pessoa = PessoaComLado & { id: string; ativo: boolean };

export type EstadoCaneta = {
  status: StatusProposta;
  canetaComId: string | null;
  canetaLado: Area | null;
  /** Lado de quem salvou a ÚLTIMA versão; `undefined` = nenhuma versão ainda; null = versão sem lado (gestão, antes da caneta). */
  ultimaVersaoLado?: Area | null;
};

/**
 * Pingue-pongue em curso: o dono edita, devolve e concorda. Revisão pedida
 * pelo cliente (GAB-89) reabre o pingue-pongue com vendas.
 */
export const STATUS_EM_CURSO: readonly StatusProposta[] = ["RASCUNHO", "EM_ANALISE", "EM_AJUSTE", "REVISAO_PEDIDA"];
/**
 * A caneta ainda importa (pronta: vendas reabre/passa; o GP pega; enviada:
 * vendas registra a resposta do cliente e pode passar para outro vendedor).
 * Aceita, recusada e inviável: ninguém com a caneta.
 */
export const STATUS_COM_CANETA: readonly StatusProposta[] = [...STATUS_EM_CURSO, "PRONTA_PARA_ENVIO", "ENVIADA"];

export const ACOES_CANETA = ["passar", "devolver", "concordar", "pegar", "reabrir", "inviavel"] as const;
export type AcaoCaneta = (typeof ACOES_CANETA)[number];

export const MOTIVO_INVIAVEL_MAX = 400;

export function outroLado(lado: Area): Area {
  return lado === "VENDAS" ? "PROJETOS" : "VENDAS";
}

/** Lado da caneta; dado sem lado conta como vendas (o pingue-pongue começa lá). */
export function ladoDaCaneta(e: Pick<EstadoCaneta, "canetaLado">): Area {
  return e.canetaLado ?? "VENDAS";
}

/** Status de quem recebe a caneta do outro lado: projetos analisa, vendas ajusta. */
export function statusAoReceber(lado: Area): StatusProposta {
  return lado === "PROJETOS" ? "EM_ANALISE" : "EM_AJUSTE";
}

/** Pode segurar a caneta: ativo, escreve e tem lado. */
export function podeAtuarNaCaneta(p: Pessoa): boolean {
  return p.ativo && podeEscrever(p.papel) && ladoDe(p) !== null;
}

export function estaComACaneta(p: Pessoa, e: EstadoCaneta): boolean {
  return podeAtuarNaCaneta(p) && e.canetaComId === p.id && ladoDe(p) === ladoDaCaneta(e);
}

/** Quem edita o rascunho (texto, parte estruturada, salvar versão): o dono, com o pingue-pongue em curso. */
export function podeEditarProposta(p: Pessoa, e: EstadoCaneta): boolean {
  return STATUS_EM_CURSO.includes(e.status) && estaComACaneta(p, e);
}

/**
 * Por que `p` não pode fazer `acao` (null = pode). `alvo` só para passar/
 * devolver: `undefined` = ainda não escolhido (não confere o destino); null =
 * pessoa não encontrada. Conteúdo (devolver sem mudança, concordar com o
 * rascunho alterado) é conferido no serviço, que vê o texto.
 */
export function recusaDaAcao(acao: AcaoCaneta, p: Pessoa, e: EstadoCaneta, alvo?: Pessoa | null): ErroProposta | null {
  if (!STATUS_COM_CANETA.includes(e.status)) return "PROPOSTA_ENCERRADA";
  const lado = ladoDaCaneta(e);
  const pronta = e.status === "PRONTA_PARA_ENVIO";
  const enviada = e.status === "ENVIADA";
  const dono = estaComACaneta(p, e);
  switch (acao) {
    case "passar":
      if (!dono) return "SEM_CANETA";
      if (alvo !== undefined && (!alvo || alvo.id === p.id || !podeAtuarNaCaneta(alvo) || ladoDe(alvo) !== lado)) return "DESTINO_MESMO_LADO";
      return null;
    case "devolver":
      if (enviada) return "PROPOSTA_COM_O_CLIENTE";
      if (pronta) return "PROPOSTA_PRONTA";
      if (!dono) return "SEM_CANETA";
      if (alvo !== undefined && (!alvo || !podeAtuarNaCaneta(alvo) || ladoDe(alvo) !== outroLado(lado))) return "DESTINO_OUTRO_LADO";
      return null;
    case "concordar":
      if (enviada) return "PROPOSTA_COM_O_CLIENTE";
      if (pronta) return "PROPOSTA_PRONTA";
      if (!dono) return "SEM_CANETA";
      if (e.ultimaVersaoLado === undefined) return "CONCORDAR_SEM_VERSAO";
      if (e.ultimaVersaoLado !== outroLado(lado)) return "CONCORDAR_PROPRIA_VERSAO";
      return null;
    case "pegar":
      if (!podeAtuarNaCaneta(p) || !ehGpDoLado(p, lado)) return "SO_GP_PEGA";
      if (e.canetaComId === p.id) return "JA_COM_A_CANETA";
      return null;
    case "reabrir":
      if (!pronta) return "REABRIR_SO_PRONTA";
      if (!dono) return "SEM_CANETA";
      return null;
    case "inviavel":
      // Enviada: a palavra é do cliente (recusa → Perdido pelo registro da resposta).
      if (enviada) return "PROPOSTA_COM_O_CLIENTE";
      if (podeAtuarNaCaneta(p) && ehGpDoLado(p, "PROJETOS")) return null;
      if (dono && lado === "PROJETOS") return null;
      return "INVIAVEL_SEM_PERMISSAO";
  }
}

/** Ações que a pessoa pode fazer agora (botões da tela, `ler_proposta` do MCP). */
export function acoesPossiveis(p: Pessoa, e: EstadoCaneta): AcaoCaneta[] {
  return ACOES_CANETA.filter((a) => recusaDaAcao(a, p, e) === null);
}
