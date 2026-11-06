/** Limite do comentário (GAB-91): sem dependência de servidor — a tela também usa. CHECK igual na migration. */
export const COMENTARIO_MAX = 2000;

/** GAB-101: tamanho do texto sugerido. CHECK igual na migration. */
export const SUGESTAO_MAX = 2000;

/** GAB-101: campos dos dados estruturados que aceitam comentário, nunca sugestão aplicável (spec proposta-folha §6). */
export const CAMPOS_COMENTARIO = ["valor", "prazo", "escopo", "entregas"] as const;
export type CampoComentario = (typeof CAMPOS_COMENTARIO)[number];
export const ROTULO_CAMPO: Record<CampoComentario, string> = { valor: "Valor total", prazo: "Prazo", escopo: "Escopo resumido", entregas: "Cronograma de entregas" };
