/**
 * Provedor `mock` (`LLM_PROVEDOR=mock`): sem rede, sem custo. Para dev local
 * sem chave e para os testes.
 *
 * Padrão: se o texto da mensagem é igual ao de uma fixture
 * (`fixtures/extracao.ts`), devolve a saída dela; senão devolve "não
 * identifiquei nada" com confiança 0 (vira `PENDENTE_REVISAO`). Testes trocam
 * a resposta com `definirRespostaMock`.
 */
import { FIXTURES_EXTRACAO, saida } from "../fixtures/extracao";
import type { PedidoExtracao, ProvedorLlm, RespostaProvedor } from "../tipos";

export const MODELO_MOCK = "mock-extracao";

/** Recebe o texto ORIGINAL da mensagem (não o prompt montado) e o pedido completo. */
export type RespostaMock = (texto: string, pedido: PedidoExtracao) => unknown | Promise<unknown>;

const g = globalThis as unknown as { __ijRespostaMock?: RespostaMock | null };

/** Troca a resposta do mock (null volta ao padrão). Lançar dentro dela simula falha do provedor. */
export function definirRespostaMock(fn: RespostaMock | null) {
  g.__ijRespostaMock = fn;
}

function respostaPadrao(texto: string): unknown {
  const f = FIXTURES_EXTRACAO.find((x) => x.texto === texto);
  return f ? f.saida : saida({ confianca: 0, resumo: "mock: mensagem sem fixture" });
}

/** Extrai o texto entre <mensagem> e </mensagem> do prompt montado. */
function textoDoPedido(pedido: PedidoExtracao): string {
  const m = /<mensagem>\n([\s\S]*)\n<\/mensagem>/.exec(pedido.usuario);
  return m ? m[1] : "";
}

export function criarProvedorMock(): ProvedorLlm {
  return {
    nome: "mock",
    async extrair(pedido): Promise<RespostaProvedor> {
      const inicio = performance.now();
      const texto = textoDoPedido(pedido);
      const fn = g.__ijRespostaMock ?? respostaPadrao;
      const bruto = await fn(texto, pedido);
      return {
        bruto: structuredClone(bruto),
        uso: { provedor: "mock", modelo: MODELO_MOCK, tokensEntrada: 0, tokensSaida: 0, ms: Math.round(performance.now() - inicio) },
      };
    },
  };
}
