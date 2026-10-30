import { formatarDataHora } from "@/lib/projetos/formatar";

/**
 * Banner para gestor/admin enquanto a API de LLM estiver sem crédito ou, no
 * Gemini, sem cota diária (GAB-46; os dois dividem o incidente).
 * Não expira por tempo: some só quando uma chamada volta a dar certo
 * (`marcarCreditoOk`) — sem sucesso, não sabemos se o saldo voltou.
 */
export function AvisoSemCredito({ desde, ultimoErro }: { desde: Date; ultimoErro: Date }) {
  return (
    <div role="alert" className="mb-6 rounded-xl border border-l-2 border-border border-l-warn bg-surface px-4 py-3 text-sm">
      <p className="font-medium text-warn">Sem crédito na API de LLM</p>
      <p className="mt-1 text-fg-soft">
        Desde <span className="font-mono">{formatarDataHora(desde)}</span>, as mensagens #crm do grupo estão ficando em FALHA. Recarregue o saldo do
        provedor; elas serão reprocessadas depois da recarga ou quando a cota diária do Gemini voltar.
      </p>
      <p className="mt-1 text-fg-mute">
        Último erro de crédito: <span className="font-mono">{formatarDataHora(ultimoErro)}</span>
      </p>
    </div>
  );
}
