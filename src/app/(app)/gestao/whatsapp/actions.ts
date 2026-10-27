"use server";

/**
 * Ações do painel de mensagens (GAB-41). Todas exigem GESTOR (vendedor → /403).
 * Reprocessar usa a MESMA função do cron (`reprocessarMensagem`).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RespostaBusca } from "@/components/entidades/busca-entidade";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { buscarCardsParaVincular, resolverManualmente, vincularRemetente, type AlvoResolver, type ErroResolver, type ErroVincular } from "@/lib/whatsapp/painel";
import { reprocessarMensagem } from "@/lib/whatsapp/reprocessar";

export type EstadoPainel = { ok?: true; erro?: string; aviso?: string; oportunidadeId?: string } | Inesperado;

const id = z.string().min(1).max(64);
const alvoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("CRIAR"), titulo: z.string().max(1000), faseId: id }),
  z.object({ tipo: z.literal("VINCULAR"), oportunidadeId: id }),
]);

const FORA_DA_FILA = "Essa mensagem não está mais na fila (já foi resolvida ou está em processamento). Recarregue a página.";

const MENSAGEM_RESOLVER: Partial<Record<ErroResolver, string>> = {
  MENSAGEM_NAO_ENCONTRADA: "Mensagem não encontrada. Recarregue a página.",
  MENSAGEM_JA_RESOLVIDA: "Essa mensagem já foi resolvida. Recarregue a página.",
  MENSAGEM_EM_PROCESSAMENTO: "Essa mensagem está sendo processada agora. Espere um pouco e recarregue.",
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído).",
  TITULO_INVALIDO: "Informe um título (até 200 caracteres).",
  FASE_NAO_ENCONTRADA: "Fase não encontrada. Recarregue a página.",
  FASE_ARQUIVADA: "Essa fase foi arquivada. Escolha outra.",
  FASE_TERMINAL: "Não dá para criar card direto numa fase de ganho/perdido. Crie numa fase aberta e mova.",
  PIPELINE_NAO_ENCONTRADO: "Quadro não encontrado.",
};

const MENSAGEM_VINCULAR: Record<ErroVincular, string> = {
  REMETENTE_NAO_ENCONTRADO: "Esse remetente já foi vinculado ou não existe mais. Recarregue a página.",
  USUARIO_NAO_ENCONTRADO: "Usuário não encontrado.",
  USUARIO_INATIVO: "Usuário desativado. Reative em Usuários antes de vincular.",
  PAPEL_NAO_PERMITIDO: "Você não pode alterar esse usuário.",
  USUARIO_JA_TEM_TELEFONE: "Esse usuário já tem outro telefone do WhatsApp. Troque em Usuários se for o caso.",
  USUARIO_JA_TEM_LID: "Esse usuário já tem outro LID do WhatsApp vinculado.",
  IDENTIFICADOR_EM_USO: "Esse telefone/LID já está em outro usuário.",
};

function revalidar() {
  revalidatePath("/gestao/whatsapp");
}

export async function reprocessarAction(mensagemId: string): Promise<EstadoPainel> {
  return comTratamento("gestao.whatsapp.reprocessar", async (): Promise<EstadoPainel> => {
    await exigirPapel("GESTOR");
    if (!id.safeParse(mensagemId).success) return { erro: "Dados inválidos." };
    const r = await reprocessarMensagem(mensagemId, ["FALHA", "PENDENTE_REVISAO"]);
    switch (r.tipo) {
      case "NAO_REPROCESSAVEL":
      case "IGNORADA":
        return { erro: FORA_DA_FILA };
      case "ERRO":
        return { ok: false, erro: "INESPERADO", ref: r.ref };
      case "PROCESSADA":
        revalidar();
        return { ok: true, aviso: "Processada: card criado/atualizado.", oportunidadeId: r.oportunidadeId };
      case "PENDENTE_REVISAO":
        revalidar();
        return { ok: true, aviso: "Continua pendente de revisão." };
      case "DESCARTADA":
        revalidar();
        return { ok: true, aviso: "Descartada: a LLM entendeu que não é registro de venda." };
      case "FALHA":
        revalidar();
        return { ok: true, aviso: `Falhou de novo (${r.codigo}, ref: ${r.ref}).` };
    }
  });
}

export async function resolverAction(mensagemId: string, alvo: AlvoResolver): Promise<EstadoPainel> {
  return comTratamento("gestao.whatsapp.resolver", async (): Promise<EstadoPainel> => {
    const ator = await exigirPapel("GESTOR");
    const a = alvoSchema.safeParse(alvo);
    if (!id.safeParse(mensagemId).success || !a.success) return { erro: "Dados inválidos." };
    const r = await resolverManualmente(mensagemId, a.data, ator);
    if (!r.ok) return { erro: MENSAGEM_RESOLVER[r.erro] ?? "Não foi possível resolver: dados do card inválidos." };
    revalidar();
    revalidatePath("/kanban");
    return { ok: true, oportunidadeId: r.oportunidadeId };
  });
}

export async function vincularRemetenteAction(remetenteId: string, usuarioId: string): Promise<EstadoPainel> {
  return comTratamento("gestao.whatsapp.vincularRemetente", async (): Promise<EstadoPainel> => {
    const ator = await exigirPapel("GESTOR");
    if (!id.safeParse(remetenteId).success || !id.safeParse(usuarioId).success) return { erro: "Dados inválidos." };
    const r = await vincularRemetente(remetenteId, usuarioId, ator);
    if (!r.ok) return { erro: MENSAGEM_VINCULAR[r.erro] };
    revalidar();
    revalidatePath("/gestao/usuarios");
    return { ok: true };
  });
}

export async function buscarCardsAction(q: string): Promise<RespostaBusca> {
  const r = await comTratamento("gestao.whatsapp.buscarCards", async (): Promise<RespostaBusca> => {
    await exigirPapel("GESTOR");
    if (typeof q !== "string") return { erro: "Dados inválidos." };
    return { ok: true, opcoes: await buscarCardsParaVincular(q) };
  });
  return "erro" in r && r.erro === "INESPERADO" ? { erro: "Não foi possível buscar. Erro no servidor.", ref: (r as Inesperado).ref } : (r as RespostaBusca);
}
