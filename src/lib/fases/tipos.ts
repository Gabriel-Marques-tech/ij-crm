import type { Fase, Pipeline } from "@prisma/client";

/** Pipeline com TODAS as fases (ativas e arquivadas), ordenadas por `ordem`. */
export type PipelineComFases = Pipeline & { fases: Fase[] };
