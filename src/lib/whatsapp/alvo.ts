/**
 * Alvo de `ATUALIZAR` (design doc §4.3 "Alvo de ATUALIZAR"). Puro: recebe as
 * oportunidades candidatas já relidas do banco (dentro da transação, depois
 * do lock) e decide qual card a mensagem atualiza.
 *
 * Ordem:
 * 1. Reply a uma confirmação do bot → o card dela, sem a LLM decidir.
 * 2. `oportunidade_id` da LLM, SÓ se estiver na lista de candidatas que foi
 *    enviada no contexto. Fora dela é ignorado (e marca revisar). Escolha
 *    sem identidade exata (só `recente`/`dominio`) vale com revisar — exceto
 *    quando é o ÚNICO card recente do remetente, aberto (mensagens picadas).
 *    O ledger da janela de 12 h (GAB-49) entra nas duas pontas: um card que
 *    só aparece no ledger (mexido há mais de 30 min) pode ser escolhido, mas
 *    com revisar; e outro card no ledger desfaz o ✅ do único recente
 *    (ambíguo → revisar). Card FECHADO que só veio pelo ledger nunca é
 *    reaberto: `NENHUM` com motivo → PENDENTE_REVISAO. Escolha de card fechado quando há um aberto por identidade →
 *    o aberto + revisar (a LLM não decide reabrir).
 * 3. Regras sobre as candidatas por identidade exata (mesmo contato por
 *    telefone/email, mesma empresa por CNPJ):
 *    - 1 aberta → ela;
 *    - >1 aberta → a tocada mais recentemente + revisar;
 *    - só terminais → card NOVO com `reaberta_de_id` da fechada mais
 *      recente + revisar.
 *    Candidatas só por domínio ou só "recentes" não decidem sem a LLM.
 * Card escolhido que está em fase terminal também vira reabertura.
 */

export type ViaCandidata = "contato" | "empresa" | "dominio" | "recente" | "ledger" | "resposta";

export type Candidata = { id: string; terminal: boolean; tocadaEm: Date; via: ViaCandidata[] };

export type Alvo =
  | { tipo: "EXISTENTE"; id: string; motivos: string[] }
  | { tipo: "REABRIR"; deId: string; motivos: string[] }
  /** `FECHADO_SEM_IDENTIDADE` (GAB-49): a LLM apontou um card fechado que só veio pelo ledger. */
  | { tipo: "NENHUM"; motivo?: "FECHADO_SEM_IDENTIDADE" };

export const MOTIVO_VARIOS_ABERTOS = "mais de um card aberto para esse contato/empresa";
export const MOTIVO_REABERTO = "card anterior estava fechado (ganho/perdido); abri um novo";
export const MOTIVO_ID_INVALIDO = "card indicado pela leitura não confere com o CRM";
export const MOTIVO_SEM_IDENTIDADE = "card deduzido pela conversa recente, sem telefone/email/CNPJ que confirme";
export const MOTIVO_FECHADO_COM_ABERTO = "leitura apontou um card fechado, mas há um aberto desse contato/empresa";

const porIdentidade = (c: Candidata) => c.via.includes("contato") || c.via.includes("empresa");
const maisRecente = (a: Candidata, b: Candidata) => b.tocadaEm.getTime() - a.tocadaEm.getTime() || a.id.localeCompare(b.id);

function escolhido(c: Candidata, motivos: string[]): Alvo {
  return c.terminal ? { tipo: "REABRIR", deId: c.id, motivos: [MOTIVO_REABERTO, ...motivos] } : { tipo: "EXISTENTE", id: c.id, motivos };
}

const daConversa = (c: Candidata) => c.via.includes("recente") || c.via.includes("ledger");

/**
 * Mensagens picadas sem ambiguidade: o card foi tocado pelo remetente nos
 * últimos 30 min, está aberto, é o ÚNICO card da conversa dele (recentes +
 * ledger da janela de 12 h) e a LLM escolheu exatamente ele, sem nenhum card
 * aberto por identidade concorrendo. Qualquer outra coisa → revisar.
 */
function unicoRecente(c: Candidata, candidatas: Candidata[], abertasIdentidade: Candidata[]): boolean {
  const conversa = candidatas.filter(daConversa);
  return !c.terminal && c.via.includes("recente") && conversa.length === 1 && conversa[0].id === c.id && abertasIdentidade.length === 0;
}

export function resolverAlvo(e: { alvoResposta: string | null; escolhaLlm: string | null; candidatas: Candidata[] }): Alvo {
  const porId = new Map(e.candidatas.map((c) => [c.id, c]));
  const abertasIdentidade = e.candidatas.filter((c) => porIdentidade(c) && !c.terminal).sort(maisRecente);

  if (e.alvoResposta && porId.has(e.alvoResposta)) return escolhido(porId.get(e.alvoResposta)!, []);

  const motivos: string[] = [];
  if (e.escolhaLlm) {
    const c = porId.get(e.escolhaLlm);
    if (c) {
      // Fechado com um aberto do mesmo contato/empresa: atualiza o aberto, nunca reabre outro.
      if (c.terminal && abertasIdentidade.length > 0) return { tipo: "EXISTENTE", id: abertasIdentidade[0].id, motivos: [MOTIVO_FECHADO_COM_ABERTO] };
      // Fechado que só apareceu pelo ledger (sem telefone/email/CNPJ, reply ou toque recente): nunca reabre.
      if (c.terminal && !porIdentidade(c) && c.via.every((v) => v === "ledger")) return { tipo: "NENHUM", motivo: "FECHADO_SEM_IDENTIDADE" };
      if (!porIdentidade(c)) return escolhido(c, unicoRecente(c, e.candidatas, abertasIdentidade) ? [] : [MOTIVO_SEM_IDENTIDADE]);
      const outrasAbertas = abertasIdentidade.some((x) => x.id !== c.id);
      return escolhido(c, outrasAbertas ? [MOTIVO_VARIOS_ABERTOS] : []);
    }
    motivos.push(MOTIVO_ID_INVALIDO);
  }

  if (abertasIdentidade.length === 1) return { tipo: "EXISTENTE", id: abertasIdentidade[0].id, motivos };
  if (abertasIdentidade.length > 1) return { tipo: "EXISTENTE", id: abertasIdentidade[0].id, motivos: [...motivos, MOTIVO_VARIOS_ABERTOS] };
  const fechadas = e.candidatas.filter((c) => porIdentidade(c) && c.terminal).sort(maisRecente);
  if (fechadas.length > 0) return { tipo: "REABRIR", deId: fechadas[0].id, motivos: [MOTIVO_REABERTO, ...motivos] };
  return { tipo: "NENHUM" };
}
