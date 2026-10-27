/**
 * Minha Semana (GAB-33), leitura: cards do vendedor em pipelines abertos e a
 * escolha de QUAL vendedor ver. Permissão do filtro é decidida aqui, no
 * servidor: vendedor sempre vê a própria semana, mesmo que mande `?vendedor=`.
 */
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { listarResponsaveis } from "@/lib/oportunidades/oportunidades";
import { agruparSemana, type Semana } from "./agrupar";

export async function listarCardsDoVendedor(responsavelId: string) {
  const cards = await db.oportunidade.findMany({
    // Aberto = vivo e fora de fase terminal (ganho/perdido), em qualquer quadro.
    where: { responsavelId, deletadoEm: null, fase: { isTerminal: false } },
    select: {
      id: true,
      titulo: true,
      proximaAcao: true,
      proximaAcaoEm: true,
      faseDesde: true,
      revisar: true,
      pipeline: { select: { chave: true, nome: true } },
      fase: { select: { nome: true, limiteDiasAlerta: true } },
      // Empresa mesclada aparece com o nome da principal (GAB-36).
      empresa: { select: SELECAO_NOME_EXIBIDO },
    },
  });
  return cards.map((c) => ({ ...c, empresa: c.empresa ? { nome: nomeExibido(c.empresa) } : null }));
}

export type CardSemana = Awaited<ReturnType<typeof listarCardsDoVendedor>>[number];

export async function carregarSemana(responsavelId: string, agora: Date): Promise<Semana<CardSemana>> {
  return agruparSemana(await listarCardsDoVendedor(responsavelId), agora);
}

export type Vendedor = { id: string; nome: string };

export type EscolhaVendedor = {
  alvo: Vendedor;
  /** Gestor/admin: mostra o seletor. */
  podeTrocar: boolean;
  /** Usuários ativos (vazio para quem não pode trocar). */
  opcoes: Vendedor[];
};

/**
 * `pedido` vem da URL (não confiável). Só GESTOR+ troca, e só para usuário
 * ativo; qualquer outra coisa cai na própria semana, sem erro.
 */
export async function resolverVendedor(ator: { id: string; papel: Papel }, pedido: string | undefined): Promise<EscolhaVendedor> {
  const podeTrocar = temPapelMinimo(ator.papel, "GESTOR");
  const opcoes = podeTrocar ? await listarResponsaveis() : [];
  const proprio = await db.usuario.findUniqueOrThrow({ where: { id: ator.id }, select: { id: true, nome: true } });
  const escolhido = podeTrocar && pedido ? opcoes.find((o) => o.id === pedido) : undefined;
  return { alvo: escolhido ?? proprio, podeTrocar, opcoes };
}
