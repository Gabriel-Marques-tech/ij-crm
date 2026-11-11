/**
 * Ferramentas MCP do painel de projetos (GAB-96): uma por indicador, só leitura, com os mesmos
 * números da tela `/painel/projetos`, porque chamam o mesmo serviço. A execução é aberta a todos,
 * como `ver_cronograma`; o tempo com a caneta vem das propostas e tem guarda.
 */
import { z } from "zod";
import { DEFINICOES_PROJETOS, VISIBILIDADE_PAINEL_PROJETOS, type IndicadorProjetos } from "@/lib/painel/definicoes";
import { carregarCanetaPara, carregarExecucaoProjetos, pessoaDoFiltro, type FiltroProjetos } from "@/lib/painel/projetos-servico";
import { refAteOPeriodoAtual, resolverPeriodo } from "@/lib/ranking/periodo";
import type { Ferramenta, Resposta } from "./ferramentas";
import { canetaDoPainelVisivel } from "./guardas";
import type { UsuarioMcp } from "./oauth";
import { urlBase } from "./url";

type Forma = z.ZodRawShape;
const ferramenta = <F extends Forma>(f: Ferramenta<F>) => f as unknown as Ferramenta;
const ok = (dados: unknown): Resposta => ({ ok: true, dados });

const PERIODO = {
  periodo: z.enum(["semana", "mes"]).optional().describe("padrão: mes"),
  ref: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD").optional().describe("um dia (AAAA-MM-DD) do período; padrão: hoje"),
};
const pessoaId = z.string().min(1).max(64).refine((v) => !v.includes("\0"), "caractere inválido");
const ENTRADA = { ...PERIODO, gp_id: pessoaId.optional().describe('id do GP do projeto, ou "eu"') };

type ArgsFiltro = { periodo?: "semana" | "mes"; ref?: string };

/** Teto de cada lista: os totais continuam completos, e `foraDaLista` diz quantos não vieram. As listas já vêm do mais grave para o menos. */
export const LIMITE_LISTA_MCP = 50;

function limitar<T>(lista: readonly T[], limite = LIMITE_LISTA_MCP): { itens: T[]; total: number; foraDaLista: number } {
  return { itens: lista.slice(0, limite), total: lista.length, foraDaLista: Math.max(0, lista.length - limite) };
}

/** Período e pessoa do pedido. Pessoa desconhecida vira erro aqui; na tela, some o filtro. */
async function lerFiltro(a: ArgsFiltro, id: string | undefined, eu: UsuarioMcp, agora: Date): Promise<{ ok: true; filtro: FiltroProjetos } | { ok: false; resposta: Resposta }> {
  if (a.ref !== undefined && !refAteOPeriodoAtual(a.periodo ?? "mes", a.ref, agora)) return { ok: false, resposta: { ok: false, erro: "ref inválido: use um dia real (AAAA-MM-DD), de 2000 para cá e até o fim do período atual." } };
  const gpId = id === "eu" ? eu.id : (id ?? null);
  if (gpId && !(await pessoaDoFiltro(gpId))) return { ok: false, resposta: { ok: false, erro: "Pessoa não encontrada. Use listar_responsaveis para ver os ids." } };
  return { ok: true, filtro: { periodo: resolverPeriodo(a.periodo ?? "mes", a.ref, agora), gpId } };
}

/** O que vai em toda resposta: o período, a fórmula do indicador e o link da mesma visão na tela. */
function moldura({ periodo, gpId }: FiltroProjetos, indicador: IndicadorProjetos) {
  const q = new URLSearchParams({ periodo: periodo.tipo, ref: periodo.primeiroDia, ...(gpId ? { gp: gpId } : {}) });
  return {
    periodo: { tipo: periodo.tipo, rotulo: periodo.rotulo, primeiroDia: periodo.primeiroDia, ultimoDia: periodo.ultimoDia, atual: periodo.atual },
    definicoes: { [indicador]: DEFINICOES_PROJETOS[indicador], visibilidade: VISIBILIDADE_PAINEL_PROJETOS },
    tela: `${urlBase()}/painel/projetos?${q.toString()}`,
  };
}

const consultarExecucao = ferramenta({
  nome: "consultar_execucao_projetos",
  titulo: "Consultar a execução dos projetos",
  descricao:
    "O projeto está andando de acordo com a proposta? Os MESMOS números da tela /painel/projetos: para cada projeto em execução, entregas previstas × feitas no período, atrasadas, atraso acumulado em dias frente ao previsto original, ajustes e status do último check-in. Projeto migrado sem cronograma vem com semPrevisto=true. Cards finalizados ou perdidos vêm em encerrados: fora de atraso e alertas, mas com previstas e feitas somadas ao total do período. Listas com `itens`, `total` e `foraDaLista` (até 50 itens; `totais` é sempre completo). Filtro opcional por GP (id ou \"eu\"). `ref` inválido é recusado. Sem valor da proposta. A resposta traz `definicoes` com as fórmulas.",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({ totais: e.totais, projetos: limitar(e.projetos), encerrados: limitar(e.encerrados), gps: e.gps, ...moldura(f.filtro, "execucao") });
  },
});

const listarAtrasados = ferramenta({
  nome: "listar_projetos_atrasados",
  titulo: "Listar os projetos atrasados",
  descricao:
    "Quais projetos estão atrasados? Projetos em execução com entrega pendente vencida, do mais atrasado para o menos, com os mesmos números da tela /painel/projetos. semPrevisto conta à parte os migrados sem cronograma, que não têm como atrasar. Lista com `itens`, `total` e `foraDaLista` (até 50 itens); os totais são completos. Filtro opcional por GP (id ou \"eu\").",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({
      comAtraso: e.totais.comAtraso,
      entregasAtrasadas: e.totais.atrasadas,
      // Só dos atrasados: projeto que só empurrou datas tem atraso acumulado, mas não está nesta lista.
      atrasoDias: e.atrasados.reduce((t, s) => t + s.atrasoDias, 0),
      semPrevisto: e.totais.semPrevisto,
      atrasados: limitar(e.atrasados),
      ...moldura(f.filtro, "atrasados"),
    });
  },
});

const listarEmAlerta = ferramenta({
  nome: "listar_projetos_em_alerta",
  titulo: "Listar os projetos em alerta",
  descricao:
    "Quais projetos estão no vermelho ou no amarelo, e quais estão sem check-in na semana? Pelo último check-in de cada projeto em execução e pela semana corrente (segunda a domingo de São Paulo), com os mesmos números da tela /painel/projetos. Listas com `itens`, `total` e `foraDaLista` (até 50 itens). Filtro opcional por GP (id ou \"eu\").",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({ vermelhos: limitar(e.alertas.vermelhos), amarelos: limitar(e.alertas.amarelos), semCheckin: limitar(e.alertas.semCheckin), ...moldura(f.filtro, "alertas") });
  },
});

const consultarCaneta = ferramenta({
  nome: "consultar_tempo_caneta_proposta",
  titulo: "Consultar o tempo com a caneta",
  descricao:
    "Com quem a caneta das propostas está parada? Por pessoa: propostas paradas agora, a mais antiga e a média em dias desde a chegada da caneta, tempo com a caneta no período, e as mais paradas, com a última edição como informação secundária; também as propostas em curso sem ninguém com a caneta, que não acompanham o filtro. Os mesmos números da tela /painel/projetos. Vem das propostas: o GP do lado (GP de vendas, PM de projetos), gestão e admin veem todas; os demais, só as propostas em que estão escalados e, com o ranking oculto, só as próprias linhas (`visao` diz qual). Filtro opcional por pessoa (id ou \"eu\").",
  escrita: false,
  guarda: canetaDoPainelVisivel,
  entrada: { ...PERIODO, pessoa_id: pessoaId.optional().describe('id da pessoa, ou "eu"') },
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.pessoa_id, eu, agora);
    if (!f.ok) return f.resposta;
    const v = await carregarCanetaPara(eu, f.filtro, agora);
    if (!v) return { ok: false, erro: "Você não tem acesso às propostas: o tempo com a caneta vem delas." };
    return ok({ visao: v.visao, ...v.caneta, ...moldura(f.filtro, "caneta") });
  },
});

export const FERRAMENTAS_PAINEL_PROJETOS: readonly Ferramenta[] = [consultarExecucao, listarAtrasados, listarEmAlerta, consultarCaneta];
