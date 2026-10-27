/**
 * Smoke do provedor de LLM configurado (`pnpm llm:smoke`, runbook §10): UMA
 * chamada real por schema — extração, classificação e resumo — com uma
 * mensagem sintética, sem dado pessoal. Serve para conferir chave, modelo,
 * schema e cota logo depois de configurar o provedor, antes de ligar o grupo.
 *
 * Imprime só operação, status, provedor/modelo, ms e tokens; nunca o texto
 * enviado nem o devolvido. Em erro, só o código/status do `ErroLlm` (cuja
 * `message` já é saneada) ou o nome da classe. Não grava nada no banco: chama
 * o provedor direto, sem `registrarLogLlm`.
 */
import { provedorConfigurado } from "./extracao";
import { JSON_SCHEMA_CLASSIFICACAO, MAX_TOKENS_CLASSIFICACAO, PROMPT_SISTEMA_CLASSIFICACAO, esquemaClassificacao, montarMensagemClassificacao } from "./prompts/classificacao.v1";
import { JSON_SCHEMA_EXTRACAO, PROMPT_SISTEMA, esquemaExtracao, montarMensagemUsuario } from "./prompts/extracao.v2";
import { JSON_SCHEMA_RESUMO, MAX_TOKENS_RESUMO, PROMPT_SISTEMA_RESUMO, esquemaResumo, montarMensagemResumo } from "./prompts/resumo.v1";
import { ErroLlm, type PedidoExtracao, type ProvedorLlm } from "./tipos";

/** Fictícia: sem telefone, email, CNPJ ou nome real. */
export const MENSAGEM_SINTETICA = "#crm Lead novo: empresa Exemplo Fictício quer um site institucional, orçamento de uns 15 mil. Próximo passo: mandar proposta sexta.";

type ZodLike = { safeParse(v: unknown): { success: true } | { success: false; error: { issues: { path: PropertyKey[] }[] } } };
type Caso = { operacao: "extracao" | "classificacao" | "resumo"; pedido: PedidoExtracao; esquema: ZodLike };

function casos(): Caso[] {
  const agora = new Date();
  const fases = [
    { chave: "primeiro_contato", nome: "Primeiro Contato", terminal: false },
    { chave: "proposta", nome: "Proposta", terminal: false },
  ];
  return [
    {
      operacao: "extracao",
      pedido: {
        sistema: PROMPT_SISTEMA,
        usuario: montarMensagemUsuario(MENSAGEM_SINTETICA, { remetente: "Vendedor Teste", recebidaEm: agora, respondendoA: null, fases, contatos: [], empresas: [], oportunidades: [], alvoResposta: null }),
        schema: JSON_SCHEMA_EXTRACAO,
      },
      esquema: esquemaExtracao,
    },
    {
      operacao: "classificacao",
      pedido: { nome: "classificacao", sistema: PROMPT_SISTEMA_CLASSIFICACAO, usuario: montarMensagemClassificacao(MENSAGEM_SINTETICA, { respondendoA: null }), schema: JSON_SCHEMA_CLASSIFICACAO, maxTokens: MAX_TOKENS_CLASSIFICACAO },
      esquema: esquemaClassificacao,
    },
    {
      operacao: "resumo",
      pedido: {
        nome: "resumo",
        sistema: PROMPT_SISTEMA_RESUMO,
        usuario: montarMensagemResumo({ vendedor: "Vendedor Teste", mensagens: [{ em: agora, texto: MENSAGEM_SINTETICA, card: { id: "card-teste", titulo: "Exemplo Fictício" } }], cards: [{ titulo: "Exemplo Fictício", fase: "Primeiro Contato" }] }),
        schema: JSON_SCHEMA_RESUMO,
        maxTokens: MAX_TOKENS_RESUMO,
      },
      esquema: esquemaResumo,
    },
  ];
}

function descreverErro(e: unknown): string {
  if (e instanceof ErroLlm) return `codigo=${e.codigo}${e.status ? ` status=${e.status}` : ""} (${e.message})`;
  return `codigo=${e instanceof Error ? e.name : typeof e}`;
}

export type OpcoesSmoke = {
  /** Injetável nos testes; padrão = provedor do ambiente (`provedorConfigurado`). */
  provedor?: (finalidade: "extracao" | "classificacao") => ProvedorLlm;
  log?: (linha: string) => void;
};

/** `true` se as três chamadas responderam JSON válido para o schema. Nunca lança. */
export async function rodarSmokeLlm({ provedor = provedorConfigurado, log = console.log }: OpcoesSmoke = {}): Promise<boolean> {
  let tudoOk = true;
  for (const c of casos()) {
    let p: ProvedorLlm;
    try {
      p = provedor(c.operacao === "classificacao" ? "classificacao" : "extracao");
    } catch (e) {
      log(`[llm-smoke] ${c.operacao} FALHA ${descreverErro(e)}`);
      tudoOk = false;
      continue;
    }
    try {
      const r = await p.extrair(c.pedido);
      const u = r.uso;
      const base = `provedor=${u.provedor} modelo=${u.modelo} ms=${u.ms} tokens_in=${u.tokensEntrada} tokens_out=${u.tokensSaida} tokens_reasoning=${u.tokensRaciocinio ?? "-"}`;
      const v = c.esquema.safeParse(r.bruto);
      if (v.success) log(`[llm-smoke] ${c.operacao} ok ${base}`);
      else {
        const campos = [...new Set(v.error.issues.map((i) => i.path.map(String).join(".") || "(raiz)"))].slice(0, 5).join(",");
        log(`[llm-smoke] ${c.operacao} FALHA codigo=SAIDA_INVALIDA campos=${campos} ${base}`);
        tudoOk = false;
      }
    } catch (e) {
      log(`[llm-smoke] ${c.operacao} FALHA ${descreverErro(e)}`);
      tudoOk = false;
    }
  }
  return tudoOk;
}
