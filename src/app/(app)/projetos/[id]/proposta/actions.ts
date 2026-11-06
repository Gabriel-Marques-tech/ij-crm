"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import type { PessoaComId } from "@/lib/auth/visibilidade";
import { recusaDaProposta } from "@/lib/propostas/acesso";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import type { ConflitoCliente } from "@/lib/propostas/autosave";
import { aplicarSugestao, MENSAGEM_ERRO_COMENTARIO, type ErroComentario } from "@/lib/propostas/comentarios";
import type { Documento } from "@/lib/propostas/documento";
import { estruturadoParaEntrada, type FormularioEstruturado } from "@/lib/propostas/estruturado";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { RESPOSTAS_CLIENTE } from "@/lib/propostas/envio";
import {
  concluirRevisao,
  concordarProposta,
  criarProposta,
  devolverProposta,
  marcarEnviada,
  marcarInviavel,
  mensagemDaFalha,
  passarCaneta,
  pegarCaneta,
  reabrirProposta,
  registrarResposta,
  salvarRascunho,
  salvarVersao,
  type Falha,
} from "@/lib/propostas/propostas";

/** Conflito para a tela: o estado atual do servidor já como documento do editor. */
export type ConflitoUI = ConflitoCliente & { documento: Documento; estruturado: FormularioEstruturado };

/**
 * `erro` = texto pronto; `conflito` quando outra aba/pessoa/o MCP gravou
 * antes (nada foi sobrescrito). Exceção → `INESPERADO` com a `ref` do log.
 */
export type RespostaProposta = { ok: true; revisao: number; numero?: number } | { ok?: false; erro: string; conflito?: ConflitoUI; semMudancas?: boolean } | Inesperado;

const id = z.string().min(1).max(64);
const revisaoSchema = z.number().int().min(0);

function falhaParaTela(f: Falha): RespostaProposta {
  // "Nada mudou" não é falha de gravação: a tela informa, sem pedir para tentar de novo.
  if (f.erro === "SEM_MUDANCAS") return { ok: false, erro: mensagemDaFalha(f), semMudancas: true };
  if (f.erro !== "CONFLITO") return { ok: false, erro: mensagemDaFalha(f) };
  const c = f.conflito;
  return {
    ok: false,
    erro: mensagemDaFalha(f),
    conflito: {
      revisao: c.revisao,
      por: c.por,
      viaMcp: c.viaMcp,
      em: c.em?.toISOString() ?? null,
      documento: markdownParaDocumento(c.markdown),
      estruturado: estruturadoParaEntrada(c.estruturado),
    },
  };
}

/** GAB-98: quem não vê a proposta nem chega à regra da caneta (que contaria o status). */
async function semAcesso(projetoId: string, ator: PessoaComId): Promise<{ erro: string } | null> {
  if (!id.safeParse(projetoId).success) return { erro: "Dados inválidos." };
  const recusa = await recusaDaProposta(projetoId, ator);
  return recusa ? { erro: recusa } : null;
}

function revalidar(projetoId: string) {
  revalidatePath(`/projetos/${projetoId}`);
  revalidatePath(`/projetos/${projetoId}/proposta`);
  revalidatePath("/propostas");
  revalidatePath("/kanban");
}

export async function criarPropostaAction(projetoId: string): Promise<RespostaProposta> {
  return comTratamento("proposta.criar", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success) return { erro: "Dados inválidos." };
    const r = await criarProposta(projetoId, ator);
    if (!r.ok) return falhaParaTela(r);
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

/** Autosave do texto (JSON do editor; o servidor valida e converte para Markdown). */
export async function salvarTextoAction(projetoId: string, revisao: number, documento: unknown): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarTexto", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await salvarRascunho(projetoId, { revisao, conteudo: { documento } }, ator);
    if (!r.ok) return falhaParaTela(r);
    return { ok: true, revisao: r.revisao };
  });
}

export async function salvarEstruturadoAction(projetoId: string, revisao: number, estruturado: unknown): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarEstruturado", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await salvarRascunho(projetoId, { revisao, estruturado }, ator);
    if (!r.ok) return falhaParaTela(r);
    revalidatePath("/propostas");
    return { ok: true, revisao: r.revisao };
  });
}

/** "Salvar versão": manda junto o texto do editor e a parte estruturada do formulário. */
export async function salvarVersaoAction(
  projetoId: string,
  revisao: number,
  dados: { documento?: unknown; estruturado?: unknown; nota?: string },
): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarVersao", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success || (dados.nota !== undefined && typeof dados.nota !== "string")) {
      return { erro: "Dados inválidos." };
    }
    const r = await salvarVersao(
      projetoId,
      {
        revisao,
        nota: dados.nota,
        ...(dados.documento !== undefined ? { conteudo: { documento: dados.documento } } : {}),
        ...(dados.estruturado !== undefined ? { estruturado: dados.estruturado } : {}),
      },
      ator,
    );
    if (!r.ok) return falhaParaTela(r);
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao, numero: r.numero };
  });
}

/**
 * GAB-101: aplica a sugestão no texto da tela, pela fila do autosave (`revisao`, conflito e a regra de
 * edição são os dele). A recusa da própria sugestão não é falha de gravação: o texto segue na fila.
 */
export async function aplicarSugestaoAction(projetoId: string, comentarioId: string, revisao: number, documento: unknown): Promise<RespostaProposta> {
  return comTratamento("proposta.aplicarSugestao", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !id.safeParse(comentarioId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await aplicarSugestao(projetoId, comentarioId, { revisao, conteudo: { documento } }, ator);
    if (r.ok) return { ok: true, revisao: r.revisao };
    if (r.erro in MENSAGEM_ERRO_COMENTARIO) return { ok: false, erro: MENSAGEM_ERRO_COMENTARIO[r.erro as ErroComentario], semMudancas: true };
    return falhaParaTela(r as Falha);
  });
}

// ---------------------------------------------------------------- caneta (GAB-87)

/** Resposta das ações da caneta: a página recarrega (quem edita mudou); `revisao` = a nova (toda ação a incrementa). */
export type RespostaCaneta = { ok: true; revisao: number } | { ok?: false; erro: string; conflito?: ConflitoUI } | Inesperado;

const textoCurto = z.string().max(4000);

/** Passar a caneta para alguém do mesmo lado. */
export async function passarCanetaAction(projetoId: string, paraId: string): Promise<RespostaCaneta> {
  return comTratamento("proposta.passarCaneta", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !id.safeParse(paraId).success) return { erro: "Escolha para quem passar a caneta." };
    const r = await passarCaneta(projetoId, paraId, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

/** Devolver ao outro lado: manda junto o editor e os dados (vira a versão entregue). */
export async function devolverAction(
  projetoId: string,
  revisao: number,
  dados: { paraId: string; documento?: unknown; estruturado?: unknown; nota?: string },
): Promise<RespostaCaneta> {
  return comTratamento("proposta.devolver", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success || (dados.nota !== undefined && typeof dados.nota !== "string")) {
      return { erro: "Dados inválidos." };
    }
    if (!id.safeParse(dados.paraId).success) return { erro: "Escolha para quem devolver." };
    const r = await devolverProposta(
      projetoId,
      {
        revisao,
        paraId: dados.paraId,
        nota: dados.nota,
        ...(dados.documento !== undefined ? { conteudo: { documento: dados.documento } } : {}),
        ...(dados.estruturado !== undefined ? { estruturado: dados.estruturado } : {}),
      },
      ator,
    );
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

export async function concordarAction(projetoId: string, revisao: number): Promise<RespostaCaneta> {
  return comTratamento("proposta.concordar", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await concordarProposta(projetoId, revisao, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

export async function pegarCanetaAction(projetoId: string): Promise<RespostaCaneta> {
  return comTratamento("proposta.pegarCaneta", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success) return { erro: "Dados inválidos." };
    const r = await pegarCaneta(projetoId, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

export async function reabrirAction(projetoId: string): Promise<RespostaCaneta> {
  return comTratamento("proposta.reabrir", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success) return { erro: "Dados inválidos." };
    const r = await reabrirProposta(projetoId, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

export async function marcarInviavelAction(projetoId: string, motivo: string): Promise<RespostaCaneta> {
  return comTratamento("proposta.inviavel", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !textoCurto.safeParse(motivo).success) return { erro: "Dados inválidos." };
    const r = await marcarInviavel(projetoId, motivo, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

// ---------------------------------------------------------------- envio e resposta do cliente (GAB-89)

/** Marca como enviada a versão `versao` (a do PDF que a pessoa baixou). */
export async function marcarEnviadaAction(projetoId: string, versao: number): Promise<RespostaCaneta> {
  return comTratamento("proposta.enviada", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !z.number().int().min(1).safeParse(versao).success) return { erro: "Dados inválidos." };
    const r = await marcarEnviada(projetoId, ator, { versao });
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

const respostaSchema = z.object({
  resposta: z.enum(RESPOSTAS_CLIENTE),
  motivo: z.string().max(50).optional(),
  detalhe: z.string().max(4000).optional(),
  pedido: z.string().max(4000).optional(),
});

/** Resposta do cliente: aceita (→ Montando contrato), recusada (motivo → Perdido) ou revisão pedida. */
export async function registrarRespostaAction(projetoId: string, dados: unknown): Promise<RespostaCaneta> {
  return comTratamento("proposta.resposta", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    const d = respostaSchema.safeParse(dados);
    if (!id.safeParse(projetoId).success || !d.success) return { erro: "Dados inválidos." };
    const r = await registrarResposta(projetoId, d.data, ator);
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    revalidatePath("/kanban");
    return { ok: true, revisao: r.revisao };
  });
}

/** Concluir a revisão sem passar por projetos: manda junto o editor e os dados (como devolver). */
export async function concluirRevisaoAction(
  projetoId: string,
  revisao: number,
  dados: { documento?: unknown; estruturado?: unknown; nota?: string },
): Promise<RespostaCaneta> {
  return comTratamento("proposta.concluirRevisao", async (): Promise<RespostaCaneta> => {
    const ator = await exigirEscrita();
    const bloqueio = await semAcesso(projetoId, ator);
    if (bloqueio) return bloqueio;
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success || (dados.nota !== undefined && typeof dados.nota !== "string")) {
      return { erro: "Dados inválidos." };
    }
    const r = await concluirRevisao(
      projetoId,
      {
        revisao,
        nota: dados.nota,
        ...(dados.documento !== undefined ? { conteudo: { documento: dados.documento } } : {}),
        ...(dados.estruturado !== undefined ? { estruturado: dados.estruturado } : {}),
      },
      ator,
    );
    if (!r.ok) return falhaParaTela(r) as RespostaCaneta;
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}
