/**
 * Regras puras do handoff (GAB-93, spec fase 2 §4.8/§4.12): o que falta para
 * entrar em Execução e quem pode fazer o quê. Sem banco: roda na tela também.
 *
 * O que vem do banco (`trava-handoff.ts`, leitura) passa por `avaliarHandoff`.
 * - Proposta congelada é automática: proposta ACEITA não muda mais. Card que
 *   nunca precisou de proposta aceita (isento da trava de contrato, ou criado
 *   direto em Projetos, sem ganho) tem o item dispensado: senão ficaria preso
 *   para sempre num item que ninguém consegue cumprir.
 * - PDF do contrato: só o anexo vivo com a marca `contratoAssinado`. Nome de
 *   arquivo não conta, para não haver falso positivo.
 * - GP nomeado é pendência também: §4.8 põe "GP nomeado" antes da execução. É
 *   reavaliado agora (saiu de projetos, virou visualizador ou foi desativado =
 *   pendência), e ele precisa ser o responsável pelo Projeto: o campo Responsável
 *   pode ter mudado depois da designação.
 */
import type { StatusProposta } from "@prisma/client";
import { ladoDe, ehGpDoLado, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever } from "@/lib/auth/papeis";

export const ITENS_MANUAIS = ["contatos", "kickoff", "acessos"] as const;
export type ItemManual = (typeof ITENS_MANUAIS)[number];

export const ROTULO_ITEM: Record<ItemManual, string> = {
  contatos: "Contatos do cliente",
  kickoff: "Kickoff marcado",
  acessos: "Acessos e materiais recebidos",
};

export const CAMPOS_RESUMO = ["contexto", "combinados", "riscos", "valoriza"] as const;
export type CampoResumo = (typeof CAMPOS_RESUMO)[number];

export const ROTULO_RESUMO: Record<CampoResumo, string> = {
  contexto: "Contexto",
  combinados: "Combinados verbais",
  riscos: "Riscos",
  valoriza: "O que o cliente valoriza",
};

export const RESUMO_CAMPO_MAX = 5000;

export type Pendencia = "GP" | "GP_RESPONSAVEL" | "PROPOSTA" | "CONTRATO" | ItemManual | "RESUMO";

export const ROTULO_PENDENCIA: Record<Pendencia, string> = {
  GP: "GP do projeto designado",
  GP_RESPONSAVEL: "GP do projeto como responsável (designe de novo)",
  PROPOSTA: "proposta final congelada",
  CONTRATO: "PDF do contrato assinado",
  contatos: "contatos do cliente",
  kickoff: "kickoff marcado",
  acessos: "acessos e materiais recebidos",
  RESUMO: "resumo de handoff completo",
};

export function descreverPendencias(p: readonly Pendencia[]): string {
  return p.map((x) => ROTULO_PENDENCIA[x]).join(", ");
}

export type DadosHandoff = {
  responsavelId: string;
  isentoTravaContrato: boolean;
  dataGanho: Date | null;
  proposta: { status: StatusProposta; versaoEnviada: number | null } | null;
  /** Anexos vivos marcados como contrato assinado. */
  anexos: readonly { id: string; nome: string }[];
  handoff: {
    gpProjeto: (PessoaComLado & { id: string; nome: string; ativo: boolean }) | null;
    contatosEm: Date | null;
    kickoffEm: Date | null;
    acessosEm: Date | null;
    resumoContexto: string;
    resumoCombinados: string;
    resumoRiscos: string;
    resumoValoriza: string;
    resumoEm: Date | null;
    resumoPor: { nome: string } | null;
  } | null;
};

export function avaliarHandoff(d: DadosHandoff) {
  const h = d.handoff;
  const aceita = d.proposta?.status === "ACEITA";
  const propostaDispensada = !aceita && (d.isentoTravaContrato || d.dataGanho === null);
  const resumo: Record<CampoResumo, string> = {
    contexto: h?.resumoContexto ?? "",
    combinados: h?.resumoCombinados ?? "",
    riscos: h?.resumoRiscos ?? "",
    valoriza: h?.resumoValoriza ?? "",
  };
  const contrato = d.anexos.at(0) ?? null;
  const gpGravado = h?.gpProjeto ?? null;
  const gpValido = !!gpGravado && podeSerGpDoProjeto(gpGravado);
  const responsavelDiverge = !!gpGravado && gpGravado.id !== d.responsavelId;
  const itens: Record<ItemManual, Date | null> = { contatos: h?.contatosEm ?? null, kickoff: h?.kickoffEm ?? null, acessos: h?.acessosEm ?? null };
  const pendencias: Pendencia[] = [];
  if (!gpValido) pendencias.push("GP");
  else if (responsavelDiverge) pendencias.push("GP_RESPONSAVEL");
  if (!aceita && !propostaDispensada) pendencias.push("PROPOSTA");
  if (!contrato) pendencias.push("CONTRATO");
  for (const i of ITENS_MANUAIS) if (!itens[i]) pendencias.push(i);
  if (CAMPOS_RESUMO.some((c) => !resumo[c].trim())) pendencias.push("RESUMO");
  return {
    gp: gpGravado ? { id: gpGravado.id, nome: gpGravado.nome } : null,
    gpValido,
    responsavelDiverge,
    proposta: { congelada: aceita, dispensada: propostaDispensada, versao: aceita ? (d.proposta?.versaoEnviada ?? null) : null },
    contrato,
    itens,
    resumo,
    resumoEm: h?.resumoEm ?? null,
    resumoPor: h?.resumoPor?.nome ?? null,
    pendencias,
  };
}

export type AvaliacaoHandoff = ReturnType<typeof avaliarHandoff>;

/** Quem escreve o resumo: vendas (spec §4.8), o lado, não um papel. Gestor sem lado não escreve. */
export function podeEscreverResumo(u: PessoaComLado): boolean {
  return podeEscrever(u.papel) && ladoDe(u) === "VENDAS";
}

/** Quem designa o GP do projeto: o PM de projetos (spec §4.12). */
export function podeDesignarGp(u: PessoaComLado): boolean {
  return ehGpDoLado(u, "PROJETOS");
}

/** Quem pode ser GP do projeto: pessoa da área projetos que escreve. */
export function podeSerGpDoProjeto(u: PessoaComLado & { ativo: boolean }): boolean {
  return u.ativo && podeEscrever(u.papel) && ladoDe(u) === "PROJETOS";
}
