/**
 * Texto da resposta do bot no grupo (design doc §4.3 passo 9). Puro.
 * 1–3 linhas, emoji de status primeiro: ✅ criado/atualizado, ⚠️ para
 * revisar ou pendente, ❌ falha (com a ref do log).
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
  | "ALVO_NAO_ENCONTRADO"
  /** GAB-49: card fechado deduzido só pelo histórico da janela, sem identidade — não reabre. */
  | "ALVO_FECHADO_SEM_IDENTIDADE"
  | "RESPOSTA_ANTIGA"
  | "RESPOSTA_CARD_REMOVIDO"
  | "RESPOSTA_FORA_DE_VENDAS"
  | "IGNORAR"
  | "CONTATO_EXCLUIDO"
  | "EMPRESA_EXCLUIDA"
  | "IDENTIFICADORES_CONFLITANTES"
  /**
   * GAB-39: sem #crm e a extração não atingiu `LLM_LIMIAR_SEM_TAG`. Os
   * `SEM_TAG_*` NÃO vão para o grupo (pendente sem tag é silencioso); o texto
   * fica para o painel de revisão.
   */
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
  RESPOSTA_ANTIGA: "⚠️ essa confirmação tem mais de 30 dias; não atualizei pelo reply, ficou na fila de revisão do CRM",
  RESPOSTA_CARD_REMOVIDO: "⚠️ o card dessa confirmação foi removido do CRM; ficou na fila de revisão",
  RESPOSTA_FORA_DE_VENDAS: "⚠️ o card dessa confirmação não está mais em Vendas; atualize pelo CRM (ficou na fila de revisão)",
  ALVO_FECHADO_SEM_IDENTIDADE:
    "⚠️ o card que parece ser esse está fechado e só deduzi pela conversa; não reabri — responde a confirmação do card ou manda telefone/email; ficou na fila de revisão do CRM",
  ALVO_NAO_ENCONTRADO: "⚠️ não achei o card para atualizar — responde a confirmação do card com a novidade; ficou na fila de revisão do CRM",
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
  texto += proxima(r);
  if (r.revisar) texto += `\nMarquei para revisar: ${linha(r.motivosRevisar[0] ?? "conferir os dados")}.`;
  return marcar(texto, opcoes);
}

/** Resultado de um ATUALIZAR aplicado num card existente (GAB-38). */
export type ResumoAtualizado = {
  titulo: string;
  /** Fase de onde o card saiu, se esta mensagem o moveu. */
  deFaseNome: string | null;
  faseNome: string;
  /** Só o que ESTA mensagem definiu (não o valor antigo do card). */
  proximaAcao: string | null;
  /** `YYYY-MM-DD` */
  proximaAcaoEm: string | null;
  /** Algum campo/fase/vínculo mudou. */
  mudou: boolean;
  revisar: boolean;
  motivosRevisar: string[];
};

function proxima(r: { proximaAcao: string | null; proximaAcaoEm: string | null }): string {
  if (r.proximaAcao) return ` Próx.: ${linha(r.proximaAcao)}${r.proximaAcaoEm ? ` (${diaMes(r.proximaAcaoEm)})` : ""}`;
  if (r.proximaAcaoEm) return ` Próx.: ${diaMes(r.proximaAcaoEm)}`;
  return "";
}

/**
 * Cita o card: "✅ Gustavo — Economia Sensata: Primeiro Contato → Reunião
 * Diagnóstica. Próx.: reunião (30/10)". Sem movimento, mostra a fase atual.
 */
export function textoAtualizado(r: ResumoAtualizado, opcoes: Opcoes = {}): string {
  const emoji = r.revisar ? "⚠️" : "✅";
  let texto: string;
  if (r.deFaseNome) texto = `${emoji} ${linha(r.titulo)}: ${linha(r.deFaseNome)} → ${linha(r.faseNome)}.`;
  else if (r.mudou) texto = `${emoji} ${linha(r.titulo)} (${linha(r.faseNome)}): atualizado.`;
  else texto = `${emoji} ${linha(r.titulo)} (${linha(r.faseNome)}): anotado na timeline, sem mudança nos campos.`;
  texto += proxima(r);
  if (r.revisar) texto += `\nMarquei para revisar: ${linha(r.motivosRevisar[0] ?? "conferir os dados")}.`;
  return marcar(texto, opcoes);
}

/** Igual a `textoCriado`, mas deixa claro que a mensagem veio sem `#crm` (o "Marquei para revisar" continua). */
/** Troca o emoji de status pelo prefixo "↪️ entendi como atualização:" (mensagem sem `#crm`). */
function semTag(texto: string, opcoes: Opcoes): string {
  return marcar(`${PREFIXO_SEM_TAG} ${texto.slice(texto.indexOf(" ") + 1)}`, opcoes);
}

export function textoCriadoSemTag(r: ResumoCriado, opcoes: Opcoes = {}): string {
  return semTag(textoCriado(r), opcoes);
}

/** `textoAtualizado` de mensagem sem `#crm` (GAB-38 + GAB-39). */
export function textoAtualizadoSemTag(r: ResumoAtualizado, opcoes: Opcoes = {}): string {
  return semTag(textoAtualizado(r), opcoes);
}

export function textoPendente(motivo: MotivoPendente, opcoes: Opcoes = {}): string {
  return marcar(TEXTO_PENDENTE[motivo], opcoes);
}

export function textoFalha(ref: string): string {
  return `❌ não consegui processar, veja no CRM (ref: ${ref})`;
}
