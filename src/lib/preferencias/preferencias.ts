/**
 * Preferências de visualização de cada usuário (`usuario.preferencias`, JSONB).
 * Ficam no servidor para acompanhar o usuário entre dispositivos.
 *
 * Formato versionado: `{ v: 1, kanban: { [pipelineChave]: { mostrarVazias, abertas } } }`,
 * em que `abertas` são CHAVES de fase (estáveis entre ambientes) abertas à mão.
 *
 * Leitura nunca lança: JSON inválido, de outra versão ou com chaves estranhas
 * vira o padrão (por quadro, quando dá: um quadro corrompido não apaga os outros).
 */
import { z } from "zod";

const chave = z.string().min(1).max(64);

/** Entrada estrita (o que a action aceita gravar). */
export const visualizacaoKanbanSchema = z.object({
  mostrarVazias: z.boolean(),
  abertas: z.array(chave).max(100),
});

export type VisualizacaoKanban = z.infer<typeof visualizacaoKanbanSchema>;

export const VISUALIZACAO_PADRAO: VisualizacaoKanban = { mostrarVazias: false, abertas: [] };

const preferenciasSchema = z.object({
  v: z.literal(1),
  kanban: z.record(chave, visualizacaoKanbanSchema.catch(() => ({ ...VISUALIZACAO_PADRAO, abertas: [] }))).catch(() => ({})),
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

export function comVisualizacaoKanban(p: Preferencias, pipelineChave: string, v: VisualizacaoKanban): Preferencias {
  return { ...p, kanban: { ...p.kanban, [pipelineChave]: v } };
}
