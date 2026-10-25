import type { Origem, TipoTerminal } from "@prisma/client";
import type { Quadro } from "@/lib/oportunidades/oportunidades";

/** Dados serializáveis que o servidor passa ao quadro cliente. */
export type FaseCliente = {
  id: string;
  nome: string;
  cor: string | null;
  limiteDiasAlerta: number | null;
  isTerminal: boolean;
  tipoTerminal: TipoTerminal | null;
};

export type CardCliente = {
  id: string;
  titulo: string;
  faseId: string;
  faseDesdeMs: number;
  revisar: boolean;
  proximaAcao: string | null;
  proximaAcaoEmMs: number | null;
  responsavelId: string;
  responsavelNome: string;
  empresaNome: string | null;
  origem: Origem | null;
  /** UF (sigla) ou null. */
  estado: string | null;
};

export function paraCliente(q: Quadro): { fases: FaseCliente[]; cards: CardCliente[] } {
  return {
    fases: q.fases.map((f) => ({
      id: f.id,
      nome: f.nome,
      cor: f.cor,
      limiteDiasAlerta: f.limiteDiasAlerta,
      isTerminal: f.isTerminal,
      tipoTerminal: f.tipoTerminal,
    })),
    cards: q.cards.map((c) => ({
      id: c.id,
      titulo: c.titulo,
      faseId: c.faseId,
      faseDesdeMs: c.faseDesde.getTime(),
      revisar: c.revisar,
      proximaAcao: c.proximaAcao,
      proximaAcaoEmMs: c.proximaAcaoEm?.getTime() ?? null,
      responsavelId: c.responsavel.id,
      responsavelNome: c.responsavel.nome,
      empresaNome: c.empresa?.nome ?? null,
      origem: c.origem,
      estado: c.estado,
    })),
  };
}
