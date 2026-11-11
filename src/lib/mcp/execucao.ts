/**
 * Ferramentas MCP da execução (GAB-95, spec §4.10/§4.13). Só traduzem argumentos e chamam
 * `lib/projetos/execucao`, a mesma camada da tela. A guarda confere a área dona do card, como nas
 * outras ferramentas; o GP do projeto, com gestor da área e admin de apoio, é do serviço: `recusaDeExecucao`.
 * Valor, versão da proposta e `copiaveis` só para quem vê a proposta.
 */
import { z } from "zod";
import { adicionarEntrega, ajustarDataEntrega, cancelarEntrega, copiarCronogramaDaProposta, cronogramaSemProposta, desmarcarEntrega, marcarEntregaFeita, MENSAGEM_ERRO_EXECUCAO, obterCronograma, recusaDeExecucao, registrarCheckin, type ErroExecucao } from "@/lib/projetos/execucao";
import { MOTIVO_MAX, STATUS_CHECKIN } from "@/lib/projetos/execucao-regras";
import { db } from "@/lib/db";
import { listarCandidatosGp } from "@/lib/projetos/handoff";
import { podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { cardEditavel, copiaDaPropostaVisivel } from "./guardas";
import type { Ferramenta, Resposta } from "./ferramentas";

type Forma = z.ZodRawShape;
const ferramenta = <F extends Forma>(f: Ferramenta<F>) => f as unknown as Ferramenta;
const id = z.string().min(1).max(64);
const dia = z.string().max(20).describe("AAAA-MM-DD");
const motivo = z.string().min(1).max(MOTIVO_MAX * 2);
const ok = (dados: unknown): Resposta => ({ ok: true, dados });
const falha = (r: { ok: false; erro: ErroExecucao }): Resposta => ({ ok: false, erro: MENSAGEM_ERRO_EXECUCAO[r.erro] });

const verCronograma = ferramenta({
  nome: "ver_cronograma",
  titulo: "Ver cronograma e check-ins do projeto",
  descricao:
    "Mostra a execução de um projeto do quadro projetos: entregas com previsto original (não muda nunca), previsto atual, data real, atrasada e ajustes com motivo; entregas canceladas à parte, com motivo; check-ins recentes (cor e motivo, o primeiro é o status atual); e quem é o GP. pode_operar diz se você pode alterar; para trocar o GP, o PM de projetos usa designar_gp_projeto com um de candidatos_gp. copiaveis > 0: nada impede a cópia, e a proposta final tem cronograma (use copiar_cronograma_proposta). Valor, versão e copiaveis só para quem vê a proposta. Sem controle de horas.",
  escrita: false,
  entrada: { id },
  executar: async (a, eu) => {
    const completo = await obterCronograma(a.id);
    if (!completo) return { ok: false, erro: "Esse projeto não está no quadro projetos (ou não existe): o cronograma começa na Execução." };
    const c = (await podeVerPropostaDoProjeto(eu, a.id)) ? completo : cronogramaSemProposta(completo);
    return ok({
      em_execucao: c.emExecucao,
      pode_operar: c.emExecucao && (await recusaDeExecucao(db, eu.id, c.gp.id)) === null,
      gp: c.gp,
      gp_designado: c.gpDesignado,
      copiaveis: c.copiaveis,
      candidatos_gp: c.emExecucao ? await listarCandidatosGp() : [],
      canceladas: c.canceladas.map((k) => ({ id: k.id, titulo: k.titulo, valor: k.valor, previsto_original: k.previstoOriginal, proposta_versao: k.propostaVersao, motivo: k.motivo, em: k.em.toISOString() })),
      entregas: c.entregas.map((e) => ({
        id: e.id,
        titulo: e.titulo,
        valor: e.valor,
        previsto_original: e.previstoOriginal,
        previsto: e.previsto,
        realizado: e.realizado,
        atrasada: e.atrasada,
        origem: e.origem,
        proposta_versao: e.propostaVersao,
        ajustes: e.ajustes.map((x) => ({ de: x.de, para: x.para, motivo: x.motivo, por: x.por, em: x.em.toISOString() })),
      })),
      checkin_na_semana: c.checkinNaSemana,
      checkins: c.checkins.map((k) => ({ status: k.status, motivo: k.motivo, semana: k.semana, por: k.por, em: k.em.toISOString() })),
    });
  },
});

const marcarEntrega = ferramenta({
  nome: "marcar_entrega",
  titulo: "Marcar entrega como feita",
  descricao: "Marca (feita=true) a entrega como feita na data real (dia, padrão hoje; não pode estar no futuro) ou desmarca (feita=false). Marcar de novo com outra data corrige. Vai para a Timeline. Ids em ver_cronograma. Só com o projeto em Execução.",
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, entrega_id: id, feita: z.boolean().optional().describe("padrão true"), dia: dia.optional() },
  executar: async (a, eu) => {
    if (a.feita === false) {
      const r = await desmarcarEntrega(a.id, a.entrega_id, eu);
      return r.ok ? ok({ mudou: r.mudou, realizado: null }) : falha(r);
    }
    const r = await marcarEntregaFeita(a.id, a.entrega_id, a.dia ?? null, eu);
    return r.ok ? ok({ mudou: r.mudou, realizado: r.dia }) : falha(r);
  },
});

const ajustarData = ferramenta({
  nome: "ajustar_data_entrega",
  titulo: "Ajustar a data prevista de uma entrega",
  descricao: `Muda a data prevista de uma entrega ainda não feita, com motivo (uma linha, até ${MOTIVO_MAX} caracteres). O previsto original fica como estava e o ajuste entra no histórico e na Timeline. Só com o projeto em Execução.`,
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, entrega_id: id, dia, motivo },
  executar: async (a, eu) => {
    const r = await ajustarDataEntrega(a.id, a.entrega_id, { dia: a.dia, motivo: a.motivo }, eu);
    return r.ok ? ok({ mudou: r.mudou }) : falha(r);
  },
});

const cancelar = ferramenta({
  nome: "cancelar_entrega",
  titulo: "Cancelar uma entrega",
  descricao: `Cancela uma entrega ainda não feita, com motivo (uma linha, até ${MOTIVO_MAX} caracteres): lançada por engano ou fora do combinado. A linha fica como registro, fora do cronograma ativo e das contas, e vai para a Timeline. Cancelada não volta: lance outra. Só com o projeto em Execução.`,
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, entrega_id: id, motivo },
  executar: async (a, eu) => {
    const r = await cancelarEntrega(a.id, a.entrega_id, { motivo: a.motivo }, eu);
    return r.ok ? ok({ mudou: r.mudou }) : falha(r);
  },
});

const adicionar = ferramenta({
  nome: "adicionar_entrega",
  titulo: "Lançar entrega no cronograma",
  descricao: "Lança uma entrega à mão (projeto sem proposta, ou entrega nova). dia é o previsto original dela; valor opcional em reais (12.500,00). Só com o projeto em Execução.",
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, titulo: z.string().min(1).max(1000), dia, valor: z.string().max(50).optional() },
  executar: async (a, eu) => {
    const r = await adicionarEntrega(a.id, { titulo: a.titulo, dia: a.dia, valor: a.valor }, eu);
    return r.ok ? ok({ entrega_id: r.entregaId }) : falha(r);
  },
});

const copiar = ferramenta({
  nome: "copiar_cronograma_proposta",
  titulo: "Copiar o cronograma da proposta final",
  descricao: "Copia as entregas da proposta aceita para um projeto em Execução ainda sem nenhuma entrega (quem entrou antes de existir o cronograma). A entrada em Execução já copia sozinha; com entrega ativa ou já copiada, é recusado.",
  escrita: true,
  guarda: copiaDaPropostaVisivel,
  entrada: { id },
  executar: async (a, eu) => {
    const r = await copiarCronogramaDaProposta(a.id, eu);
    return r.ok ? ok({ entregas: r.entregas }) : falha(r);
  },
});

const checkin = ferramenta({
  nome: "registrar_checkin",
  titulo: "Registrar o check-in semanal",
  descricao: `Check-in do projeto em Execução: status VERDE, AMARELO ou VERMELHO e uma linha de motivo (até ${MOTIVO_MAX} caracteres). Aparece no card do quadro e na Timeline. Registrar de novo na semana vale: o último é o status.`,
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, status: z.enum(STATUS_CHECKIN), motivo },
  executar: async (a, eu) => {
    const r = await registrarCheckin(a.id, { status: a.status, motivo: a.motivo }, eu);
    return r.ok ? ok({ checkin_id: r.checkinId, semana: r.semana }) : falha(r);
  },
});

export const FERRAMENTAS_EXECUCAO: readonly Ferramenta[] = [verCronograma, marcarEntrega, ajustarData, cancelar, adicionar, copiar, checkin];
