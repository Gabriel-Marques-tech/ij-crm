/**
 * Falhas de regra de Empresa/Contato/vínculo → texto específico para a UI, e
 * o formato de resposta das server actions dessas telas. Puro.
 */
import type { Inesperado } from "@/lib/erros/registrar";
import type { FalhaContato } from "@/lib/contatos/contatos";
import type { FalhaEmpresa } from "@/lib/empresas/empresas";
import type { ErroVinculo } from "@/lib/oportunidades/vinculos";

/** Dono de um identificador que o usuário tentou repetir (para "vincular?" / "ver"). */
export type Duplicado = { tipo: "contato" | "empresa"; id: string; nome: string; deletado?: boolean };

export type EstadoEntidade = { ok?: true; erro?: string; id?: string; duplicado?: Duplicado } | Inesperado;

export function mensagemFalhaContato(f: FalhaContato): { erro: string; duplicado?: Duplicado } {
  switch (f.erro) {
    case "NOME_INVALIDO":
      return { erro: "Informe o nome do contato (até 200 caracteres)." };
    case "CONTATO_NAO_ENCONTRADO":
      return { erro: "Contato não encontrado (pode ter sido excluído ou mesclado). Recarregue a página." };
    case "EMPRESA_NAO_ENCONTRADA":
      return { erro: "Empresa não encontrada (pode ter sido excluída ou mesclada)." };
    case "PONTO_NAO_ENCONTRADO":
      return { erro: "Esse telefone/email já não está no contato. Recarregue a página." };
    case "PONTO_INVALIDO":
      return { erro: `"${f.valor.slice(0, 60)}" não é um telefone brasileiro (com DDD) nem um email válido.` };
    case "CAMPO_INVALIDO":
      return { erro: f.mensagem };
    case "PONTO_DUPLICADO": {
      const o = f.ponto.tipo === "TELEFONE" ? "esse telefone" : "esse email";
      const dono = f.contato.deletado ? `${f.contato.nome} (contato excluído)` : f.contato.nome;
      return { erro: `${o[0].toUpperCase()}${o.slice(1)} já é de ${dono}.`, duplicado: { tipo: "contato", id: f.contato.id, nome: f.contato.nome, deletado: f.contato.deletado } };
    }
  }
}

export function mensagemFalhaEmpresa(f: FalhaEmpresa): { erro: string; duplicado?: Duplicado } {
  switch (f.erro) {
    case "NOME_INVALIDO":
      return { erro: "Informe o nome da empresa (até 200 caracteres)." };
    case "EMPRESA_NAO_ENCONTRADA":
      return { erro: "Empresa não encontrada (pode ter sido excluída ou mesclada). Recarregue a página." };
    case "CAMPO_INVALIDO":
      return { erro: f.mensagem };
    case "CNPJ_DUPLICADO":
      return { erro: `Esse CNPJ já é de ${f.empresa.nome}.`, duplicado: { tipo: "empresa", id: f.empresa.id, nome: f.empresa.nome } };
  }
}

export const MENSAGEM_VINCULO: Record<ErroVinculo, string> = {
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
  EMPRESA_NAO_ENCONTRADA: "Empresa não encontrada (pode ter sido excluída ou mesclada).",
  CONTATO_NAO_ENCONTRADO: "Contato não encontrado (pode ter sido excluído ou mesclado).",
};
