/**
 * Cache em memória de pipelines+fases. Gestor edita fases em Gestão → Fases e
 * o app reflete sem deploy: toda escrita do serviço chama `invalidar()`.
 *
 * TTL curto como rede de segurança: escritas que não passam pelo serviço
 * (seed, SQL manual, outro processo) aparecem em no máximo `TTL_PADRAO_MS`.
 * A invalidação explícita continua sendo o caminho normal (imediato).
 *
 * É por processo (v1 roda um único container de app). Fica em `globalThis`
 * pelo mesmo motivo do `db.ts`: sobreviver ao hot reload e a bundles de rota
 * duplicados no Next — senão uma action invalidaria um cache e a página leria outro.
 */
import type { PipelineComFases } from "./tipos";

export const TTL_PADRAO_MS = 30_000;

export type CacheMemoria<T> = {
  obter(carregar: () => Promise<T>): Promise<T>;
  invalidar(): void;
};

export function criarCacheMemoria<T>(opts: { ttlMs?: number; agora?: () => number } = {}): CacheMemoria<T> {
  const ttlMs = opts.ttlMs ?? TTL_PADRAO_MS;
  const agora = opts.agora ?? Date.now;
  let emVoo: Promise<T> | null = null;
  // Definido quando a carga termina (TTL conta do fim, não do início).
  let expiraEm: number | null = null;

  return {
    obter(carregar) {
      if (emVoo && expiraEm !== null && agora() > expiraEm) {
        emVoo = null;
        expiraEm = null;
      }
      if (!emVoo) {
        const p = carregar();
        emVoo = p;
        expiraEm = null;
        // Falha não fica em cache; e se alguém invalidou enquanto carregava,
        // não derruba a carga nova que já pode estar no lugar.
        p.then(
          () => {
            if (emVoo === p) expiraEm = agora() + ttlMs;
          },
          () => {
            if (emVoo === p) emVoo = null;
          },
        );
      }
      return emVoo;
    },
    invalidar() {
      emVoo = null;
      expiraEm = null;
    },
  };
}

const g = globalThis as unknown as { __ijCachePipelines?: CacheMemoria<PipelineComFases[]> };

export const cachePipelines: CacheMemoria<PipelineComFases[]> = (g.__ijCachePipelines ??= criarCacheMemoria());

export function invalidarCachePipelines() {
  cachePipelines.invalidar();
}
