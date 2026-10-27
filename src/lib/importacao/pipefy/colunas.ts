/**
 * Mapeamento de colunas do export do Pipefy → campos do CRM (GAB-37). Puro.
 *
 * O CSV real ainda não chegou: os nomes abaixo seguem o relatório padrão do
 * Pipefy ("Exportar cards" / relatório do pipe, em inglês e em português) e os
 * rótulos mais prováveis dos campos customizados do pipe da IJ. Cabeçalho é
 * comparado normalizado (sem acento, minúsculo, pontuação vira espaço), então
 * "Fase atual", "FASE ATUAL" e "fase_atual" casam igual. Para um nome novo,
 * acrescente o alias aqui (ou passe `aliases` extras — o CLI aceita
 * `--colunas arquivo.json`).
 *
 * Histórico de fases: colunas por fase, com o nome da fase no cabeçalho
 * ("First time in Reunião Diagnóstica", "Primeira entrada na fase Perdido",
 * "Last time out …", "Total time in …"). `PADROES_HISTORICO` tira o nome da fase.
 */
import { normalizarTexto } from "./valores";

export const CAMPOS = [
  "pipefyId",
  "titulo",
  "faseAtual",
  "criadoEm",
  "atualizadoEm",
  "finalizadoEm",
  "responsaveis",
  "etiquetas",
  "empresa",
  "cnpj",
  "contatoNome",
  "telefone",
  "email",
  "cargo",
  "origem",
  "dor",
  "descricao",
  "orcamento",
  "valorFechado",
  "motivoPerda",
  "propostaUrl",
  "cidade",
  "estado",
] as const;

export type Campo = (typeof CAMPOS)[number];

export const OBRIGATORIOS: Campo[] = ["pipefyId", "titulo", "faseAtual"];

export type Aliases = Record<Campo, string[]>;

export const ALIASES_PADRAO: Aliases = {
  pipefyId: ["Card ID", "ID", "Card id", "ID do card", "Código", "Codigo do card"],
  titulo: ["Title", "Título", "Titulo", "Nome do card", "Card title"],
  faseAtual: ["Current phase", "Fase atual", "Phase", "Fase"],
  criadoEm: ["Created at", "Criado em", "Data de criação", "Creation date"],
  atualizadoEm: ["Updated at", "Atualizado em", "Última atualização", "Last update"],
  finalizadoEm: ["Finished at", "Finalizado em", "Concluído em", "Done at"],
  responsaveis: ["Assignees", "Assignee", "Responsáveis", "Responsável", "Vendedor", "Vendedor responsável"],
  etiquetas: ["Labels", "Etiquetas", "Label", "Etiqueta"],
  empresa: ["Empresa", "Nome da empresa", "Company", "Cliente", "Razão social"],
  cnpj: ["CNPJ", "CNPJ da empresa"],
  contatoNome: ["Nome do contato", "Contato", "Contact name", "Contact", "Nome do cliente", "Pessoa de contato"],
  telefone: ["Telefone", "Telefone do contato", "Phone", "Celular", "WhatsApp", "Telefone/WhatsApp"],
  email: ["Email", "E-mail", "Email do contato", "E-mail do contato"],
  cargo: ["Cargo", "Cargo do contato", "Job title"],
  origem: ["Origem", "Origem do lead", "Source", "Canal"],
  dor: ["Dor", "Dor do cliente", "Necessidade"],
  // Descrição do card do Pipefy → `Oportunidade.descricao` (antes caía em `dor`).
  descricao: ["Descrição", "Descricao", "Description", "Descrição do card", "Card description"],
  orcamento: ["Orçamento", "Orçamento previsto", "Valor estimado", "Valor previsto", "Budget"],
  valorFechado: ["Valor fechado", "Valor do contrato", "Valor final", "Contract value"],
  motivoPerda: ["Motivo da perda", "Motivo de perda", "Motivo", "Loss reason"],
  propostaUrl: ["Proposta", "Link da proposta", "Proposta (link)", "Proposal"],
  cidade: ["Cidade", "City"],
  estado: ["Estado", "UF", "State"],
};

export type TipoHistorico = "entrada" | "ultimaEntrada" | "saida" | "tempo";

/**
 * Cabeçalho (normalizado) → tipo + nome da fase (grupo 1). Normalizado tira
 * acento e pontuação: "Primeira entrada na fase 'Reunião Diagnóstica'" vira
 * "primeira entrada na fase reuniao diagnostica" — o nome volta a casar com a
 * fase do CRM pela mesma normalização. "tempo" é só informativo (ignorado).
 */
export const PADROES_HISTORICO: [RegExp, TipoHistorico][] = [
  [/^(?:first time (?:enter(?:ed)? |entered )?(?:in |into |on )?|first entry (?:in |into )?)(?:the )?(?:phase )?(.+)$/, "entrada"],
  [/^(?:primeira (?:vez|entrada|data de entrada) (?:na|no|em) )(?:fase )?(.+)$/, "entrada"],
  [/^(?:data de )?entrada (?:na|no|em) (?:fase )?(.+)$/, "entrada"],
  [/^(?:last time (?:enter(?:ed)? |entered )?(?:in |into |on )|last entry (?:in |into )?)(?:the )?(?:phase )?(.+)$/, "ultimaEntrada"],
  [/^(?:ultima (?:vez|entrada) (?:na|no|em) )(?:fase )?(.+)$/, "ultimaEntrada"],
  [/^(?:last time (?:exit(?:ed)?|out|left|leave)(?: of| from)? |last exit (?:from |of )?)(?:the )?(?:phase )?(.+)$/, "saida"],
  [/^(?:ultima saida|data de saida|saida) (?:da|do|de) (?:fase )?(.+)$/, "saida"],
  [/^(?:total )?time (?:in|on) (?:the )?(?:phase )?(.+?)(?: days| hours| dias| horas)?$/, "tempo"],
  [/^tempo (?:total )?(?:na|no|em) (?:fase )?(.+?)(?: dias| horas)?$/, "tempo"],
];

export type ColunaHistorico = { indice: number; fase: string; tipo: TipoHistorico };

export type MapaColunas = {
  colunas: Partial<Record<Campo, number>>;
  historico: ColunaHistorico[];
  /** Cabeçalhos sem uso (campos customizados que o CRM não tem). */
  ignoradas: string[];
};

export type ResultadoColunas = { ok: true; mapa: MapaColunas } | { ok: false; erro: string };

/** Junta aliases extras aos padrões (extras primeiro: têm prioridade). */
export function combinarAliases(extras?: Partial<Record<Campo, string[]>>): Aliases {
  const r = { ...ALIASES_PADRAO };
  for (const c of CAMPOS) if (extras?.[c]?.length) r[c] = [...extras[c]!, ...ALIASES_PADRAO[c]];
  return r;
}

export function mapearCabecalho(cabecalho: string[], aliases: Aliases = ALIASES_PADRAO): ResultadoColunas {
  const norm = cabecalho.map((h) => normalizarTexto(h));
  const usados = new Set<number>();
  const colunas: Partial<Record<Campo, number>> = {};
  // Campo por campo, na ordem dos aliases: o 1º alias que existir ganha.
  for (const campo of CAMPOS) {
    for (const alias of aliases[campo]) {
      const a = normalizarTexto(alias);
      const i = norm.findIndex((h, idx) => h === a && !usados.has(idx));
      if (i >= 0) {
        colunas[campo] = i;
        usados.add(i);
        break;
      }
    }
  }
  const historico: ColunaHistorico[] = [];
  const ignoradas: string[] = [];
  norm.forEach((h, indice) => {
    if (usados.has(indice)) return;
    for (const [re, tipo] of PADROES_HISTORICO) {
      const m = re.exec(h);
      if (m && m[1].trim()) {
        historico.push({ indice, fase: m[1].trim(), tipo });
        return;
      }
    }
    if (cabecalho[indice].trim()) ignoradas.push(cabecalho[indice].trim());
  });
  const faltando = OBRIGATORIOS.filter((c) => colunas[c] === undefined);
  if (faltando.length > 0) {
    const lista = faltando.map((c) => `${ROTULO_CAMPO[c]} (${aliases[c].slice(0, 3).map((a) => `"${a}"`).join(", ")})`).join("; ");
    return { ok: false, erro: `Colunas obrigatórias não encontradas: ${lista}. Confira se é o export de cards do Pipefy.` };
  }
  return { ok: true, mapa: { colunas, historico, ignoradas } };
}

export const ROTULO_CAMPO: Record<Campo, string> = {
  pipefyId: "ID do card",
  titulo: "Título",
  faseAtual: "Fase atual",
  criadoEm: "Criado em",
  atualizadoEm: "Atualizado em",
  finalizadoEm: "Finalizado em",
  responsaveis: "Responsáveis",
  etiquetas: "Etiquetas",
  empresa: "Empresa",
  cnpj: "CNPJ",
  contatoNome: "Nome do contato",
  telefone: "Telefone",
  email: "Email",
  cargo: "Cargo",
  origem: "Origem",
  dor: "Dor",
  descricao: "Descrição",
  orcamento: "Orçamento previsto",
  valorFechado: "Valor fechado",
  motivoPerda: "Motivo da perda",
  propostaUrl: "Proposta (link)",
  cidade: "Cidade",
  estado: "Estado",
};
