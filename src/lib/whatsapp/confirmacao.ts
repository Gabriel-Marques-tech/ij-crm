/**
 * Texto da resposta do bot no grupo (design doc §4.3 passo 9). Puro.
 * 1–3 linhas, emoji de status primeiro: ✅ criado, ⚠️ criado para revisar ou
 * pendente, ❌ falha (com a ref do log).
 *
 * Todo texto que veio da LLM (ou de cadastro) passa por `linha()`: quebras e
 * espaços colapsados e corte em ~80 caracteres com "…", para a resposta
 * nunca passar de 3 linhas nem ecoar um bloco grande no grupo.
 *
 * Mensagem que já tinha terminado em ❌ e foi reprocessada (GAB-41) ganha
 * "Reprocessada:" depois do emoji, para o grupo entender a 2ª resposta.
 *
 * Mensagem SEM `#crm` que o bot entendeu e aplicou (GAB-39) troca o emoji
 * por "↪️ entendi como atualização:", para o grupo saber que não houve tag.
 */

export type MotivoPendente =
  | "SEM_NOME"
  | "ATUALIZAR"
  | "IGNORAR"
  | "CONTATO_EXCLUIDO"
  | "EMPRESA_EXCLUIDA"
  | "IDENTIFICADORES_CONFLITANTES"
  /** GAB-39: sem #crm e a extração não atingiu `LLM_LIMIAR_SEM_TAG`. */
  | "SEM_TAG_INCERTO"
  /** GAB-39: sem #crm, CRIAR sem telefone/email/CNPJ citado (defesa contra injeção). */
  | "SEM_TAG_SEM_IDENTIFICADOR";

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
  SEM_TAG_INCERTO: "⚠️ parece atualização de venda (sem #crm), mas não tive certeza; ficou na fila de revisão do CRM",
  SEM_TAG_SEM_IDENTIFICADOR: "⚠️ parece lead novo (sem #crm), mas sem telefone, email ou CNPJ; ficou na fila de revisão do CRM",
};

/** `YYYY-MM-DD` → `DD/MM`. */
function diaMes(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

export const MAX_TRECHO = 80;

/** Uma linha só, sem espaços sobrando, no máximo `max` caracteres (com "…"). */
export function linha(s: string, max = MAX_TRECHO): string {
  const t = s.replace(/\s+/gu, " ").trim();
  const chars = [...t];
  return chars.length <= max ? t : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

type Opcoes = { reprocessada?: boolean };

export const PREFIXO_SEM_TAG = "↪️ entendi como atualização:";

/** "✅ texto" → "✅ Reprocessada: texto" quando for o caso. */
function marcar(texto: string, { reprocessada }: Opcoes): string {
  if (!reprocessada) return texto;
  const i = texto.indexOf(" ");
  return `${texto.slice(0, i)} Reprocessada: ${texto.slice(i + 1)}`;
}

export function textoCriado(r: ResumoCriado, opcoes: Opcoes = {}): string {
  let texto = `${r.revisar ? "⚠️" : "✅"} ${linha(r.titulo)} → ${linha(r.faseNome)}. Resp: ${linha(r.responsavelNome)}.`;
  if (r.proximaAcao) texto += ` Próx.: ${linha(r.proximaAcao)}${r.proximaAcaoEm ? ` (${diaMes(r.proximaAcaoEm)})` : ""}`;
  else if (r.proximaAcaoEm) texto += ` Próx.: ${diaMes(r.proximaAcaoEm)}`;
  if (r.revisar) texto += `\nMarquei para revisar: ${linha(r.motivosRevisar[0] ?? "conferir os dados")}.`;
  return marcar(texto, opcoes);
}

/** Igual a `textoCriado`, mas deixa claro que a mensagem veio sem `#crm` (o "Marquei para revisar" continua). */
export function textoCriadoSemTag(r: ResumoCriado, opcoes: Opcoes = {}): string {
  const texto = textoCriado(r);
  return marcar(`${PREFIXO_SEM_TAG} ${texto.slice(texto.indexOf(" ") + 1)}`, opcoes);
}

export function textoPendente(motivo: MotivoPendente, opcoes: Opcoes = {}): string {
  return marcar(TEXTO_PENDENTE[motivo], opcoes);
}

export function textoFalha(ref: string): string {
  return `❌ não consegui processar, veja no CRM (ref: ${ref})`;
}
