/**
 * Alvo de `ATUALIZAR` (design doc §4.3 "Alvo de ATUALIZAR"). Puro: recebe as
 * oportunidades candidatas já relidas do banco (dentro da transação, depois
 * do lock) e decide qual card a mensagem atualiza.
 *
 * Ordem:
 * 1. Reply a uma confirmação do bot → o card dela, sem a LLM decidir.
 * 2. `oportunidade_id` da LLM, SÓ se estiver na lista de candidatas que foi
 *    enviada no contexto. Fora dela é ignorado (e marca revisar).
 * 3. Regras sobre as candidatas por identidade exata (mesmo contato por
 *    telefone/email, mesma empresa por CNPJ):
 *    - 1 aberta → ela;
 *    - >1 aberta → a tocada mais recentemente + revisar;
 *    - só terminais → card NOVO com `reaberta_de_id` da fechada mais
 *      recente + revisar.
 *    Candidatas só por domínio ou só "recentes" não decidem sem a LLM.
 * Card escolhido que está em fase terminal também vira reabertura.
 */

export type ViaCandidata = "contato" | "empresa" | "dominio" | "recente" | "resposta";

export type Candidata = { id: string; terminal: boolean; tocadaEm: Date; via: ViaCandidata[] };

export type Alvo = { tipo: "EXISTENTE"; id: string; motivos: string[] } | { tipo: "REABRIR"; deId: string; motivos: string[] } | { tipo: "NENHUM" };

export const MOTIVO_VARIOS_ABERTOS = "mais de um card aberto para esse contato/empresa";
export const MOTIVO_REABERTO = "card anterior estava fechado (ganho/perdido); abri um novo";
export const MOTIVO_ID_INVALIDO = "card indicado pela leitura não confere com o CRM";

const porIdentidade = (c: Candidata) => c.via.includes("contato") || c.via.includes("empresa");
const maisRecente = (a: Candidata, b: Candidata) => b.tocadaEm.getTime() - a.tocadaEm.getTime() || a.id.localeCompare(b.id);

function escolhido(c: Candidata, motivos: string[]): Alvo {
  return c.terminal ? { tipo: "REABRIR", deId: c.id, motivos: [MOTIVO_REABERTO, ...motivos] } : { tipo: "EXISTENTE", id: c.id, motivos };
}

export function resolverAlvo(e: { alvoResposta: string | null; escolhaLlm: string | null; candidatas: Candidata[] }): Alvo {
  const porId = new Map(e.candidatas.map((c) => [c.id, c]));
  const abertasIdentidade = e.candidatas.filter((c) => porIdentidade(c) && !c.terminal).sort(maisRecente);

  if (e.alvoResposta && porId.has(e.alvoResposta)) return escolhido(porId.get(e.alvoResposta)!, []);

  const motivos: string[] = [];
  if (e.escolhaLlm) {
    const c = porId.get(e.escolhaLlm);
    if (c) {
      const outrasAbertas = abertasIdentidade.some((x) => x.id !== c.id);
      return escolhido(c, outrasAbertas && porIdentidade(c) ? [MOTIVO_VARIOS_ABERTOS] : []);
    }
    motivos.push(MOTIVO_ID_INVALIDO);
  }

  if (abertasIdentidade.length === 1) return { tipo: "EXISTENTE", id: abertasIdentidade[0].id, motivos };
  if (abertasIdentidade.length > 1) return { tipo: "EXISTENTE", id: abertasIdentidade[0].id, motivos: [...motivos, MOTIVO_VARIOS_ABERTOS] };
  const fechadas = e.candidatas.filter((c) => porIdentidade(c) && c.terminal).sort(maisRecente);
  if (fechadas.length > 0) return { tipo: "REABRIR", deId: fechadas[0].id, motivos: [MOTIVO_REABERTO, ...motivos] };
  return { tipo: "NENHUM" };
}
