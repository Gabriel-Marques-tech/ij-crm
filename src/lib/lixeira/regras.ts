/**
 * Regras puras da lixeira e do merge (GAB-36): permissões da matriz de papéis
 * (§4.5), validação de merge e mensagens em português. Sem banco.
 */
import type { Papel } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";

export type ErroLixeira =
  | "SEM_PERMISSAO"
  | "CARD_NAO_ENCONTRADO"
  | "CONTATO_NAO_ENCONTRADO"
  | "EMPRESA_NAO_ENCONTRADA"
  | "NAO_ESTA_NA_LIXEIRA"
  | "FASE_ARQUIVADA_ESCOLHA"
  | "FASE_INVALIDA"
  | "FASE_INCOMPATIVEL"
  | "CONFIRMACAO_NAO_CONFERE"
  | "CONTATO_TEM_MESCLADOS"
  | "EMPRESA_TEM_MESCLADOS"
  | ErroMerge;

export type ErroMerge = "MESMO_REGISTRO" | "PRINCIPAL_INVALIDO" | "PERDEDOR_INVALIDO" | "PERDEDOR_TEM_MESCLADOS" | "NAO_MESCLADO";

export type FalhaLixeira = { erro: ErroLixeira; fase?: { id: string; nome: string }; mesclados?: number };

/** Soft-delete de card: qualquer usuário que escreve (action: `exigirEscrita`). Restaurar (cards, contatos, empresas) e excluir contato/empresa: gestor+. */
export const podeRestaurar = (papel: Papel) => temPapelMinimo(papel, "GESTOR");
export const podeMesclar = (papel: Papel) => temPapelMinimo(papel, "GESTOR");
export const podeExcluirEntidade = (papel: Papel) => temPapelMinimo(papel, "GESTOR");
/** Deleção definitiva: só admin. */
export const podeApagarDeVez = (papel: Papel) => temPapelMinimo(papel, "ADMIN");

type Registro = { id: string; deletadoEm: Date | null; mergedIntoId: string | null };

/**
 * Merge tem UM nível: o principal está vivo e não mesclado; o perdedor está
 * vivo, não mesclado e ninguém aponta para ele. Assim não há cadeia nem
 * ciclo (A→B→A) por construção — a leitura ainda tem teto de saltos.
 */
export function validarMerge(m: { principal: Registro | null; perdedor: Registro | null; mescladosNoPerdedor: number }): ErroMerge | null {
  const { principal, perdedor } = m;
  if (principal && perdedor && principal.id === perdedor.id) return "MESMO_REGISTRO";
  if (!principal || principal.deletadoEm || principal.mergedIntoId) return "PRINCIPAL_INVALIDO";
  if (!perdedor || perdedor.deletadoEm || perdedor.mergedIntoId) return "PERDEDOR_INVALIDO";
  if (m.mescladosNoPerdedor > 0) return "PERDEDOR_TEM_MESCLADOS";
  return null;
}

const espacos = (s: string) => s.trim().replace(/\s+/g, " ");

/** Confirmação dupla da deleção definitiva: digitar o título/nome exato. */
export function confirmacaoConfere(digitado: string, titulo: string): boolean {
  const d = espacos(digitado);
  return d !== "" && d === espacos(titulo);
}

export function mensagemLixeira(f: FalhaLixeira): string {
  switch (f.erro) {
    case "SEM_PERMISSAO":
      return "Você não tem permissão para isso.";
    case "CARD_NAO_ENCONTRADO":
      return "Card não encontrado (pode já ter sido excluído ou apagado). Recarregue a página.";
    case "CONTATO_NAO_ENCONTRADO":
      return "Contato não encontrado (pode ter sido excluído, mesclado ou apagado). Recarregue a página.";
    case "EMPRESA_NAO_ENCONTRADA":
      return "Empresa não encontrada (pode ter sido excluída, mesclada ou apagada). Recarregue a página.";
    case "NAO_ESTA_NA_LIXEIRA":
      return "Esse registro não está na lixeira. Recarregue a página.";
    case "FASE_ARQUIVADA_ESCOLHA":
      return `A fase “${f.fase?.nome ?? "?"}” foi arquivada enquanto o card estava na lixeira. Escolha a fase para onde ele volta.`;
    case "FASE_INVALIDA":
      return "Fase inválida: escolha uma fase ativa do mesmo quadro.";
    case "FASE_INCOMPATIVEL":
      return "A fase escolhida precisa ser do mesmo tipo da original (aberta, ganho ou perdido).";
    case "CONFIRMACAO_NAO_CONFERE":
      return "O texto digitado não confere com o título. Nada foi apagado.";
    case "CONTATO_TEM_MESCLADOS":
    case "EMPRESA_TEM_MESCLADOS": {
      const n = f.mesclados ?? 0;
      const registros = n === 1 ? "1 registro mesclado" : `${n} registros mesclados`;
      const alvo = f.erro === "EMPRESA_TEM_MESCLADOS" ? `Esta empresa tem ${registros} nela` : `Este contato tem ${registros} nele`;
      return `${alvo}. Desfaça os merges antes de excluir.`;
    }
    case "MESMO_REGISTRO":
      return "Escolha dois registros diferentes.";
    case "PRINCIPAL_INVALIDO":
      return "O principal precisa estar ativo (não excluído nem mesclado em outro).";
    case "PERDEDOR_INVALIDO":
      return "O registro a mesclar precisa estar ativo (não excluído nem já mesclado).";
    case "PERDEDOR_TEM_MESCLADOS":
      return "Esse registro já recebeu outros merges. Desfaça-os antes (ou escolha-o como principal).";
    case "NAO_MESCLADO":
      return "Esse registro não está mesclado. Recarregue a página.";
  }
}
