import { obterVinculosDoCard } from "@/lib/oportunidades/vinculos";
import { VinculosCliente } from "./vinculos-cliente";

/**
 * Empresa e Contato do card (GAB-31). Carrega o próprio dado (excluída/mesclada
 * descrita como tal) para o detalhe do card só precisar de uma linha.
 * A página que o usa já chamou `exigirUsuario()`.
 */
export async function Vinculos({ cardId }: { cardId: string }) {
  const v = await obterVinculosDoCard(cardId);
  if (!v) return null;
  return <VinculosCliente cardId={cardId} empresa={v.empresa} contato={v.contato} />;
}
