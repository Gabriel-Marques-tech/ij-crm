/**
 * Cache em memória de pipelines+fases. Gestor edita fases em Gestão → Fases e
 * o app reflete sem deploy: toda escrita do serviço chama `invalidar()`.
 *
 * É por processo (v1 roda um único container de app). Fica em `globalThis`
 * pelo mesmo motivo do `db.ts`: sobreviver ao hot reload e a bundles de rota
 * duplicados no Next — senão uma action invalidaria um cache e a página leria outro.
 */
import type { PipelineComFases } from "./tipos";

export type CacheMemoria<T> = {
  obter(carregar: () => Promise<T>): Promise<T>;
  invalidar(): void;
};

export function criarCacheMemoria<T>(): CacheMemoria<T> {
  let emVoo: Promise<T> | null = null;
  return {
    obter(carregar) {
      if (!emVoo) {
        const p = carregar();
        emVoo = p;
        // Falha não fica em cache; e se alguém invalidou enquanto carregava,
        // não derruba a carga nova que já pode estar no lugar.
        p.catch(() => {
          if (emVoo === p) emVoo = null;
        });
      }
      return emVoo;
    },
    invalidar() {
      emVoo = null;
    },
  };
}

const g = globalThis as unknown as { __ijCachePipelines?: CacheMemoria<PipelineComFases[]> };

export const cachePipelines: CacheMemoria<PipelineComFases[]> = (g.__ijCachePipelines ??= criarCacheMemoria());

export function invalidarCachePipelines() {
  cachePipelines.invalidar();
}
