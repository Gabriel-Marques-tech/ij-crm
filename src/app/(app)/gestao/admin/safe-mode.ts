/**
 * Texto do safe mode no Admin (GAB-42). Em produção o normal é ENVIAR
 * (`NOTIFICATIONS_ENABLED=true` no go-live): o aviso é quando está calado.
 * Fora de produção o normal é não enviar: o aviso é quando envia.
 */
export type SituacaoSafeMode = { ambiente: "produção" | "desenvolvimento"; aviso: boolean; titulo: string; texto: string };

export function situacaoSafeMode({ producao, enviando }: { producao: boolean; enviando: boolean }): SituacaoSafeMode {
  const ambiente = producao ? "produção" : "desenvolvimento";
  if (producao && !enviando)
    return {
      ambiente,
      aviso: true,
      titulo: "Envio desligado",
      texto: "Atenção — bot silencioso em produção: confirmações e alertas não estão sendo enviados. Para ligar, defina NOTIFICATIONS_ENABLED=true no ambiente e reinicie.",
    };
  if (producao) return { ambiente, aviso: false, titulo: "Envio ligado", texto: "O bot responde no grupo (confirmações e alertas)." };
  if (enviando)
    return {
      ambiente,
      aviso: true,
      titulo: "Envio ligado fora de produção",
      texto: "Este ambiente envia mensagens reais ao grupo do WhatsApp. Para pausar, remova NOTIFICATIONS_ENABLED=true do ambiente e reinicie.",
    };
  return { ambiente, aviso: false, titulo: "Envio desligado (safe mode)", texto: "O CRM processa as mensagens, mas não responde nada no grupo." };
}
