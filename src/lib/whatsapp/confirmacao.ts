/**
 * Texto da resposta do bot no grupo (design doc §4.3 passo 9). Puro.
 * 1–3 linhas, emoji de status primeiro: ✅ criado, ⚠️ criado para revisar ou
 * pendente, ❌ falha (com a ref do log).
 */

export type MotivoPendente =
  | "SEM_NOME"
  | "ATUALIZAR"
  | "IGNORAR"
  | "CONTATO_EXCLUIDO"
  | "EMPRESA_EXCLUIDA"
  | "IDENTIFICADORES_CONFLITANTES";

export type ResumoCriado = {
  titulo: string;
  faseNome: string;
  responsavelNome: string;
  proximaAcao: string | null;
  /** `YYYY-MM-DD` */
  proximaAcaoEm: string | null;
  revisar: boolean;
  /** Em ordem de importância; a confirmação mostra só o primeiro. */
  motivosRevisar: string[];
};

const TEXTO_PENDENTE: Record<MotivoPendente, string> = {
  SEM_NOME: "⚠️ não identifiquei o lead — responde esta mensagem com o nome",
  ATUALIZAR: "⚠️ atualizar card pelo WhatsApp ainda não está ativo; ficou na fila de revisão do CRM",
  IGNORAR: "⚠️ não entendi como registro de venda; ficou na fila de revisão do CRM",
  CONTATO_EXCLUIDO: "⚠️ esse telefone/email é de um contato excluído do CRM; ficou na fila de revisão",
  EMPRESA_EXCLUIDA: "⚠️ esse CNPJ é de uma empresa excluída do CRM; ficou na fila de revisão",
  IDENTIFICADORES_CONFLITANTES: "⚠️ os dados da mensagem batem com cadastros diferentes no CRM; ficou na fila de revisão",
};

/** `YYYY-MM-DD` → `DD/MM`. */
function diaMes(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

export function textoCriado(r: ResumoCriado): string {
  let linha = `${r.revisar ? "⚠️" : "✅"} ${r.titulo} → ${r.faseNome}. Resp: ${r.responsavelNome}.`;
  if (r.proximaAcao) linha += ` Próx.: ${r.proximaAcao}${r.proximaAcaoEm ? ` (${diaMes(r.proximaAcaoEm)})` : ""}`;
  else if (r.proximaAcaoEm) linha += ` Próx.: ${diaMes(r.proximaAcaoEm)}`;
  if (!r.revisar) return linha;
  const motivo = r.motivosRevisar[0] ?? "conferir os dados";
  return `${linha}\nMarquei para revisar: ${motivo}.`;
}

export function textoPendente(motivo: MotivoPendente): string {
  return TEXTO_PENDENTE[motivo];
}

export function textoFalha(ref: string): string {
  return `❌ não consegui processar, veja no CRM (ref: ${ref})`;
}
