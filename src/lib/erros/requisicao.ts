/**
 * Erro não tratado numa requisição (página, route handler, action sem
 * `comTratamento`): o Next chama `onRequestError` (src/instrumentation.ts) com o
 * erro já carimbado com `digest` — o mesmo identificador que chega ao error
 * boundary no cliente (`error.digest`). Logamos a causa com ref = digest, então
 * a ref da tela é a do log: `grep 'ref=<digest>'`.
 *
 * Limite: o Next só carimba `digest` no caminho de RENDER (páginas/layouts).
 * Em route handler e server action não há digest nem error boundary: logamos
 * com ref gerada, que não chega à UI. Por isso esses caminhos usam
 * `comTratamento` e devolvem a própria ref (JSON/estado da action); este hook
 * é só a rede de segurança para o que escapar.
 *
 * Não logamos `request.path` (query/params podem ter email ou token): só o
 * molde da rota (`/(auth)/redefinir/[token]`).
 */
import { unstable_rethrow } from "next/navigation";
import { registrarErro } from "./registrar";

type Contexto = { routeType: string; routePath: string };

function ehControleDoNext(e: unknown): boolean {
  // redirect/notFound/etc. não são falha; o Next já os filtra, mas sem custo garantir.
  try {
    unstable_rethrow(e);
    return false;
  } catch {
    return true;
  }
}

export function registrarErroDeRequisicao(e: unknown, contexto: Contexto): void {
  if (ehControleDoNext(e)) return;
  const digest = typeof e === "object" && e !== null && "digest" in e && typeof e.digest === "string" ? e.digest : undefined;
  registrarErro(`${contexto.routeType} ${contexto.routePath}`, e, digest);
}
