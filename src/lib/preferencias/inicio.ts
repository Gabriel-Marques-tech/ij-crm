import { registrarErro } from "@/lib/erros/registrar";
import { destinoInicio, PREFERENCIAS_PADRAO, type DestinoInicio, type Preferencias } from "./preferencias";

/**
 * Destino da página inicial para o logo do shell. Nunca lança: o layout de
 * todas as páginas depende disso, então banco fora vira log com ref e Minha
 * Semana (o padrão), em vez de derrubar o app inteiro.
 */
export async function resolverInicio(ler: () => Promise<Preferencias>): Promise<DestinoInicio> {
  try {
    return destinoInicio(await ler());
  } catch (e) {
    registrarErro("layout.inicio", e);
    return destinoInicio(PREFERENCIAS_PADRAO);
  }
}
