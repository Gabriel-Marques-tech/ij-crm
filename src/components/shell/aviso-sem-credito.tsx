import { formatarDataHora } from "@/lib/oportunidades/formatar";

/**
 * Banner para gestor/admin enquanto a API de LLM estiver sem crédito (GAB-46).
 * Some sozinho quando uma chamada volta a dar certo (`marcarCreditoOk`).
 */
export function AvisoSemCredito({ desde }: { desde: Date }) {
  return (
    <div role="alert" className="mb-6 rounded-xl border border-l-2 border-border border-l-warn bg-surface px-4 py-3 text-sm">
      <p className="font-medium text-warn">Sem crédito na API de LLM</p>
      <p className="mt-1 text-fg-soft">
        Desde <span className="font-mono">{formatarDataHora(desde)}</span>, as mensagens #crm do grupo estão ficando em FALHA. Recarregue o saldo do
        provedor; elas serão reprocessadas depois da recarga.
      </p>
    </div>
  );
}
