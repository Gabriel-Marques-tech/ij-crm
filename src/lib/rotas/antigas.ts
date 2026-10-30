/**
 * Rotas antigas do card (GAB-80): a entidade passou a se chamar Projeto e o
 * detalhe do card mora em `/projetos/[id]`. Links salvos (favoritos, mensagens,
 * histórico do navegador) para `/kanban/:id` e `/oportunidades/:id` continuam
 * funcionando via redirect do Next (`next.config.ts`). `/kanban` (o quadro)
 * não muda: o padrão `:id` exige um segmento depois da barra.
 *
 * `permanent: false` (307/308 temporário): a fase 2 ainda mexe em rotas
 * (GAB-81); redirect permanente ficaria preso no cache do navegador.
 */
export type RedirectAntigo = { source: string; destination: string; permanent: false };

export const REDIRECTS_ROTAS_ANTIGAS: RedirectAntigo[] = [
  { source: "/kanban/:id", destination: "/projetos/:id", permanent: false },
  { source: "/oportunidades/:id", destination: "/projetos/:id", permanent: false },
  { source: "/oportunidades", destination: "/kanban", permanent: false },
];
