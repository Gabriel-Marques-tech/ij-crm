/**
 * Preferências de visualização de cada usuário (`usuario.preferencias`, JSONB).
 * Ficam no servidor para acompanhar o usuário entre dispositivos.
 *
 * Formato versionado: `{ v: 1, kanban: { [pipelineChave]: { mostrarVazias, abertas } }, inicio?, avisos? }`,
 * em que `abertas` são CHAVES de fase (estáveis entre ambientes) abertas à mão e
 * `inicio` é o que abre dentro da área (semana | kanban; GAB-97, antes GAB-43) e
 * `avisos.whatsapp` liga/desliga o WhatsApp privado dos avisos (GAB-88; ausente = ligado).
 *
 * Leitura nunca lança: JSON inválido, de outra versão ou com chaves estranhas
 * vira o padrão (por quadro, quando dá: um quadro corrompido não apaga os outros).
 */
import { z } from "zod";
import { exibicaoSchema, type Exibicao } from "@/lib/tarefas/exibicao";

const chave = z.string().min(1).max(64);

/** Entrada estrita (o que a action aceita gravar). */
export const visualizacaoKanbanSchema = z.object({
  mostrarVazias: z.boolean(),
  abertas: z.array(chave).max(100),
});

export type VisualizacaoKanban = z.infer<typeof visualizacaoKanbanSchema>;

export const VISUALIZACAO_PADRAO: VisualizacaoKanban = { mostrarVazias: false, abertas: [] };

/** O que abre dentro da área (GAB-97). Ausente = Minha Semana. Aditivo na v1: sem migração de versão. */
export const inicioSchema = z.enum(["semana", "kanban"]);
export type PaginaInicial = z.infer<typeof inicioSchema>;

/** Leitura: `vendas` e `projetos` (GAB-43) escolhiam um quadro; a área agora decide qual, e eles valem como kanban. */
const inicioGravadoSchema = z.enum(["semana", "kanban", "vendas", "projetos"]).transform((i): PaginaInicial => (i === "semana" ? "semana" : "kanban"));

const preferenciasSchema = z.object({
  v: z.literal(1),
  kanban: z.record(chave, visualizacaoKanbanSchema.catch(() => ({ ...VISUALIZACAO_PADRAO, abertas: [] }))).catch(() => ({})),
  inicio: inicioGravadoSchema.optional().catch(undefined),
  avisos: z.object({ whatsapp: z.boolean() }).optional().catch(undefined),
  /** Exibição do kanban interno de tarefas (quadro/lista, agrupar, ordenar…), igual em todos os projetos. */
  tarefas: exibicaoSchema.optional().catch(undefined),
});

export type Preferencias = z.infer<typeof preferenciasSchema>;

export const PREFERENCIAS_PADRAO: Preferencias = { v: 1, kanban: {} };

export function lerPreferencias(bruto: unknown): Preferencias {
  const r = preferenciasSchema.safeParse(bruto);
  return r.success ? r.data : { v: 1, kanban: {} };
}

/** Visualização de um quadro; descarta chaves de fase que não existem mais (e repetidas). */
export function visualizacaoKanban(p: Preferencias, pipelineChave: string, chavesFases: readonly string[]): VisualizacaoKanban {
  const v = p.kanban[pipelineChave];
  if (!v) return { ...VISUALIZACAO_PADRAO, abertas: [] };
  const existentes = new Set(chavesFases);
  return { mostrarVazias: v.mostrarVazias, abertas: [...new Set(v.abertas)].filter((k) => existentes.has(k)) };
}

export function paginaInicial(p: Preferencias): PaginaInicial {
  return p.inicio ?? "semana";
}

export function comInicio(p: Preferencias, inicio: PaginaInicial): Preferencias {
  return { ...p, inicio };
}

/** WhatsApp privado dos avisos ("é sua vez", "aceita/handoff"). Padrão: ligado. O sino no app não desliga. */
export function whatsappAvisosLigado(p: Preferencias): boolean {
  return p.avisos?.whatsapp ?? true;
}

export function comWhatsappAvisos(p: Preferencias, whatsapp: boolean): Preferencias {
  return { ...p, avisos: { whatsapp } };
}

export function comVisualizacaoKanban(p: Preferencias, pipelineChave: string, v: VisualizacaoKanban): Preferencias {
  return { ...p, kanban: { ...p.kanban, [pipelineChave]: v } };
}

export function comExibicaoTarefas(p: Preferencias, e: Exibicao): Preferencias {
  return { ...p, tarefas: e };
}
