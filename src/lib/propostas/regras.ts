/**
 * Regras puras da proposta (GAB-86): quem cria, rótulos de status e textos
 * de erro (os mesmos na tela e no MCP). Roda no cliente e no servidor.
 * Quem EDITA e a máquina de estados do pingue-pongue: `./caneta.ts` (GAB-87).
 */
import type { StatusProposta } from "@prisma/client";
import { ladoDe, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever, temPapelMinimo } from "@/lib/auth/papeis";
import { MOTIVO_INVIAVEL_MAX } from "./caneta";

export const ROTULO_STATUS_PROPOSTA: Record<StatusProposta, string> = {
  RASCUNHO: "Rascunho",
  EM_ANALISE: "Em análise",
  EM_AJUSTE: "Em ajuste",
  PRONTA_PARA_ENVIO: "Pronta para envio",
  ENVIADA: "Enviada",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  REVISAO_PEDIDA: "Revisão pedida",
  INVIAVEL: "Inviável",
};

export const STATUS_PROPOSTA: readonly StatusProposta[] = Object.keys(ROTULO_STATUS_PROPOSTA) as StatusProposta[];

export const NOTA_VERSAO_MAX = 500;

/**
 * Quem CRIA a proposta: quem escreve no CRM e é de VENDAS e responsável pelo
 * Projeto; gestão (gestor/admin) também. Depois de criada, quem edita é o dono
 * da caneta (`podeEditarProposta` em ./caneta.ts) — gestão não age na caneta.
 */
export function podeCriarProposta(pessoa: PessoaComLado & { id: string }, projeto: { responsavelId: string }): boolean {
  if (!podeEscrever(pessoa.papel)) return false;
  if (temPapelMinimo(pessoa.papel, "GESTOR")) return true;
  return ladoDe(pessoa) === "VENDAS" && projeto.responsavelId === pessoa.id;
}

export type ErroProposta =
  | "PROJETO_NAO_ENCONTRADO"
  | "PROPOSTA_NAO_ENCONTRADA"
  | "PROPOSTA_JA_EXISTE"
  // GAB-93: Projeto já no quadro Projetos (depois do Ganho): a proposta não muda mais.
  | "PROPOSTA_CONGELADA"
  | "SEM_PERMISSAO"
  | "CONTEUDO_INVALIDO"
  | "CONTEUDO_LONGO"
  | "NOTA_LONGA"
  | "SEM_MUDANCAS"
  | "VERSAO_NAO_ENCONTRADA"
  // GAB-87: caneta e pingue-pongue
  | "SEM_CANETA"
  | "PROPOSTA_PRONTA"
  | "PROPOSTA_ENCERRADA"
  | "DESTINO_MESMO_LADO"
  | "DESTINO_OUTRO_LADO"
  | "CONCORDAR_SEM_VERSAO"
  | "CONCORDAR_PROPRIA_VERSAO"
  | "CONCORDAR_RASCUNHO_ALTERADO"
  | "DEVOLVER_SEM_MUDANCAS"
  | "SO_GP_PEGA"
  | "JA_COM_A_CANETA"
  | "REABRIR_SO_PRONTA"
  | "INVIAVEL_SEM_PERMISSAO"
  | "MOTIVO_INVIAVEL_OBRIGATORIO"
  | "MOTIVO_INVIAVEL_LONGO"
  | "PROJETO_FORA_DE_VENDAS"
  | "PROJETO_ENCERRADO"
  | "FASE_PERDIDO_INDISPONIVEL"
  // GAB-89: envio e resposta do cliente
  | "PROPOSTA_COM_O_CLIENTE"
  | "ENVIAR_SO_PRONTA"
  | "ENVIO_SO_VENDAS"
  | "RESPONDER_SO_ENVIADA"
  | "RESPOSTA_INVALIDA"
  | "PEDIDO_REVISAO_LONGO"
  | "CONCLUIR_REVISAO_SO_PEDIDA"
  | "REVISAO_MUDOU_ESTRUTURADO"
  | "VERSAO_FINAL_MUDOU"
  | "PDF_INDISPONIVEL"
  | "PDF_OCUPADO"
  | "FASE_MONTANDO_CONTRATO_INDISPONIVEL";

export const MENSAGEM_ERRO_PROPOSTA: Record<ErroProposta, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado (pode ter sido excluído). Recarregue a página.",
  PROPOSTA_NAO_ENCONTRADA: "Este projeto ainda não tem proposta.",
  PROPOSTA_JA_EXISTE: "Este projeto já tem uma proposta (é uma por projeto).",
  SEM_PERMISSAO: "Só quem é de vendas e responsável pelo projeto (ou a gestão) cria a proposta. Você pode ler.",
  CONTEUDO_INVALIDO: "Conteúdo inválido: use só a formatação do editor (títulos, negrito, itálico, listas e linha).",
  CONTEUDO_LONGO: "A proposta passou do tamanho máximo (100 mil caracteres).",
  NOTA_LONGA: `A nota da versão pode ter até ${NOTA_VERSAO_MAX} caracteres.`,
  SEM_MUDANCAS: "Nada mudou desde a última versão: não há o que salvar.",
  VERSAO_NAO_ENCONTRADA: "Versão não encontrada.",
  SEM_CANETA: "Você não está com a caneta: só quem está com ela edita, passa, devolve ou concorda. Você pode ler (e comentar).",
  PROPOSTA_PRONTA: "A proposta está pronta para envio: para mudar algo, reabra para ajuste antes.",
  PROPOSTA_CONGELADA: "O projeto já passou do Ganho e está no quadro Projetos: a proposta final fica congelada, ninguém edita. Dá para ler e comentar.",
  PROPOSTA_ENCERRADA: "A proposta já foi respondida pelo cliente (aceita ou recusada) ou marcada inviável: não dá mais para editar nem mexer na caneta.",
  DESTINO_MESMO_LADO: "Passar a caneta é para outra pessoa do MESMO lado, ativa e que pode editar. Para mandar ao outro lado, use Devolver.",
  DESTINO_OUTRO_LADO: "Devolver é para alguém do OUTRO lado (vendas ↔ projetos), ativo e que pode editar.",
  CONCORDAR_SEM_VERSAO: "Ainda não há versão do outro lado para concordar.",
  CONCORDAR_PROPRIA_VERSAO: "Só dá para concordar com uma versão que veio do outro lado. A última versão é do seu lado: devolva para o outro lado avaliar.",
  CONCORDAR_RASCUNHO_ALTERADO: "O rascunho mudou depois da versão recebida, e concordar é aceitar sem editar. Devolva (salva uma versão com as mudanças) ou desfaça-as.",
  DEVOLVER_SEM_MUDANCAS: "Nada mudou desde a versão que veio do outro lado: para aceitá-la como está, use Concordar.",
  SO_GP_PEGA: "Só o GP do lado que está com a caneta (GP de vendas, PM de projetos) pode pegá-la. Peça a quem está com ela para passar.",
  JA_COM_A_CANETA: "Você já está com a caneta.",
  REABRIR_SO_PRONTA: "Só dá para reabrir uma proposta pronta para envio.",
  INVIAVEL_SEM_PERMISSAO: "Só o PM de projetos ou quem está com a caneta do lado de projetos marca a proposta como inviável.",
  MOTIVO_INVIAVEL_OBRIGATORIO: "Diga o motivo de a proposta ser inviável.",
  MOTIVO_INVIAVEL_LONGO: `O motivo pode ter até ${MOTIVO_INVIAVEL_MAX} caracteres.`,
  PROJETO_FORA_DE_VENDAS:
    "O projeto não está no quadro de Vendas: a proposta não mexe mais nele (inviável, aceite ou recusa). Se o cliente quer mudar a proposta, registre Revisão pedida; para aceitar ou recusar, traga o card de volta a Vendas pelo Kanban antes.",
  PROJETO_ENCERRADO: "O projeto já está em ganho ou perdido: reabra o card antes (marcar a proposta inviável ou registrar aceite/recusa move o card).",
  FASE_PERDIDO_INDISPONIVEL: "A fase Perdido do quadro de Vendas não está disponível (arquivada?). Fale com a gestão.",
  PROPOSTA_COM_O_CLIENTE: "A proposta foi enviada e está com o cliente: registre a resposta dele (aceita, recusada ou revisão pedida). Revisão pedida reabre a edição com vendas.",
  ENVIAR_SO_PRONTA: "Só dá para marcar como enviada uma proposta pronta para envio (consenso entre vendas e projetos).",
  ENVIO_SO_VENDAS: "Quem envia e registra a resposta do cliente é vendas: quem está com a caneta (de vendas) ou o GP de vendas.",
  RESPONDER_SO_ENVIADA: "Só dá para registrar a resposta do cliente depois de marcar a proposta como enviada.",
  RESPOSTA_INVALIDA: "Resposta inválida: use aceita, recusada ou revisão pedida.",
  PEDIDO_REVISAO_LONGO: "O pedido de revisão pode ter até 1000 caracteres.",
  CONCLUIR_REVISAO_SO_PEDIDA: "Só dá para concluir a revisão de uma proposta com revisão pedida pelo cliente.",
  REVISAO_MUDOU_ESTRUTURADO:
    "Escopo, prazo, valor ou entregas mudaram desde a versão enviada: a proposta tem de passar por projetos. Use Devolver (para projetos avaliar) em vez de concluir a revisão direto.",
  VERSAO_FINAL_MUDOU: "A versão final da proposta mudou desde que você baixou o PDF. Baixe o PDF de novo antes de marcar como enviada.",
  PDF_INDISPONIVEL: "O PDF sai da versão final: a proposta precisa estar pronta para envio (ou já enviada).",
  PDF_OCUPADO: "O CRM já está gerando 2 PDFs agora (limite para não sobrecarregar o servidor). Tente de novo em alguns segundos.",
  FASE_MONTANDO_CONTRATO_INDISPONIVEL: "A fase Montando contrato do quadro de Vendas não está disponível (arquivada?). Fale com a gestão.",
};

/** Texto do conflito de edição concorrente (tela e MCP). */
export function mensagemConflito(c: { revisao: number; por: string | null; viaMcp: boolean }): string {
  const quem = c.por ? ` por ${c.por}${c.viaMcp ? " (via MCP)" : ""}` : "";
  return `A proposta foi alterada em outro lugar${quem} (agora na revisão ${c.revisao}). Nada foi sobrescrito: recarregue a versão atual e reaplique a sua mudança.`;
}
