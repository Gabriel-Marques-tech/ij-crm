/**
 * Calendário (GAB-51), leitura: o que já existe no CRM (próximas ações dos
 * cards abertos) + prazos, só da semana visível. Duas queries (ações e
 * prazos), sem N+1. Usado pela aba Calendário e pela Minha Semana.
 *
 * Etapa 2 (Google Calendar, reuniões) entra como uma terceira fonte aqui:
 * `carregarItensDaSemana` devolve listas por tipo e a grade agrupa por dia.
 */
import type { Papel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { listarResponsaveis } from "@/lib/oportunidades/oportunidades";
import { compararPrazos, paraPrazoItem, PRAZO_VIVO, SELECAO_PRAZO, type PessoaItem, type PrazoItem } from "@/lib/prazos/prazos";
import { instanteDoPrazo, type SemanaCalendario } from "./semana";

type Ator = { id: string; papel: Papel };

export type AcaoItem = {
  cardId: string;
  titulo: string;
  /** Texto da próxima ação (pode faltar: só a data foi definida). */
  acao: string | null;
  dia: string;
  empresa: string | null;
  fase: string;
  quadro: string;
  responsavel: PessoaItem;
  /** Dia antes de hoje (o card está aberto: só abertos entram). */
  vencida: boolean;
};

export type ItensDaSemana = { acoes: AcaoItem[]; prazos: PrazoItem[] };

/** De quem: lista de responsáveis ou o time todo. */
export type FiltroPessoas = { responsavelIds: string[] } | "time";

export async function carregarItensDaSemana(filtro: FiltroPessoas, semana: SemanaCalendario, ator: Ator): Promise<ItensDaSemana> {
  const resp = filtro === "time" ? {} : { responsavelId: { in: filtro.responsavelIds } };
  const [cards, prazos] = await Promise.all([
    db.oportunidade.findMany({
      // Mesma fonte da Minha Semana: vivo e fora de fase terminal, em qualquer quadro.
      where: { ...resp, deletadoEm: null, fase: { isTerminal: false }, proximaAcaoEm: { gte: semana.inicio, lt: semana.fim } },
      select: {
        id: true,
        titulo: true,
        proximaAcao: true,
        proximaAcaoEm: true,
        fase: { select: { nome: true } },
        pipeline: { select: { chave: true } },
        empresa: { select: SELECAO_NOME_EXIBIDO },
        responsavel: { select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } } },
      },
    }),
    db.prazo.findMany({
      where: { ...resp, ...PRAZO_VIVO, data: { gte: instanteDoPrazo(semana.segunda), lte: instanteDoPrazo(semana.domingo) } } satisfies Prisma.PrazoWhereInput,
      select: SELECAO_PRAZO,
    }),
  ]);

  const acoes = cards
    .map((c): AcaoItem => {
      const dia = diaEmFuso(c.proximaAcaoEm!);
      return {
        cardId: c.id,
        titulo: c.titulo,
        acao: c.proximaAcao,
        dia,
        empresa: c.empresa ? nomeExibido(c.empresa) : null,
        fase: c.fase.nome,
        quadro: c.pipeline.chave,
        responsavel: { id: c.responsavel.id, nome: c.responsavel.nome, fotoEm: c.responsavel.foto?.atualizadoEm.getTime() ?? null },
        vencida: dia < semana.hoje,
      };
    })
    .sort((a, b) => (a.dia !== b.dia ? (a.dia < b.dia ? -1 : 1) : a.responsavel.nome.localeCompare(b.responsavel.nome, "pt-BR") || a.titulo.localeCompare(b.titulo, "pt-BR")));

  return { acoes, prazos: prazos.map((p) => paraPrazoItem(p, ator, semana.hoje)).sort(compararPrazos) };
}

export type Visao = {
  modo: "meu" | "time" | "pessoa";
  /** Só em `pessoa`. */
  pessoa: { id: string; nome: string } | null;
  /** Usuários ativos (seletor "Pessoa" e responsável do prazo). */
  opcoes: { id: string; nome: string }[];
  filtro: FiltroPessoas;
};

/**
 * `?ver=time` ou `?pessoa=<id>` (da URL, não confiável). Todo mundo vê o time
 * todo; o padrão é a própria agenda. Pessoa inativa/inexistente → "Meu".
 */
export async function resolverVisao(ator: Ator, params: { ver?: string; pessoa?: string }): Promise<Visao> {
  const opcoes = await listarResponsaveis();
  if (params.ver === "time") return { modo: "time", pessoa: null, opcoes, filtro: "time" };
  const pessoa = params.pessoa && params.pessoa !== ator.id ? opcoes.find((o) => o.id === params.pessoa) : undefined;
  if (pessoa) return { modo: "pessoa", pessoa, opcoes, filtro: { responsavelIds: [pessoa.id] } };
  return { modo: "meu", pessoa: null, opcoes, filtro: { responsavelIds: [ator.id] } };
}
