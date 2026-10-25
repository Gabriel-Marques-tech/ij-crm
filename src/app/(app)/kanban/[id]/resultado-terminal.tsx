import Link from "next/link";
import { FolderKanban, Handshake } from "lucide-react";
import { formatarDataHora, formatarDinheiro } from "@/lib/oportunidades/formatar";
import type { DetalheCard } from "@/lib/oportunidades/oportunidades";

type Vinculado = NonNullable<DetalheCard["projeto"]>;

function LinkVinculado({ c }: { c: Vinculado }) {
  if (c.deletadoEm) return <span className="text-fg-mute">{c.titulo} (removido)</span>;
  return (
    <Link href={`/kanban/${c.id}?quadro=${c.pipeline.chave}`} className="text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
      {c.titulo}
    </Link>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

/**
 * Resultado do card (GAB-32): ganho (valor fechado, data) ou perda (motivo) e
 * o vínculo venda ↔ projeto. Só leitura: muda movendo de fase. Nada a mostrar → nada.
 */
export function ResultadoTerminal({ card }: { card: DetalheCard }) {
  const itens: React.ReactNode[] = [];
  if (card.dataGanho) {
    itens.push(
      <Item key="data" rotulo="Ganho em">
        <span className="font-mono tabular">{formatarDataHora(card.dataGanho)}</span>
      </Item>,
      <Item key="valor" rotulo="Valor fechado">
        <span className="font-mono tabular">{card.valorFechado ? formatarDinheiro(card.valorFechado.toFixed(2)) : "—"}</span>
      </Item>,
    );
  }
  if (card.motivoPerda) {
    itens.push(
      <Item key="motivo" rotulo="Motivo da perda">
        <span title={card.motivoPerda}>{card.motivoPerda}</span>
      </Item>,
    );
  }
  if (card.projeto) {
    itens.push(
      <Item key="projeto" rotulo="Projeto">
        <span className="inline-flex items-center gap-1.5">
          <FolderKanban aria-hidden className="size-3.5 shrink-0 text-fg-mute" />
          <LinkVinculado c={card.projeto} />
        </span>
      </Item>,
    );
  }
  if (card.origemOportunidade) {
    itens.push(
      <Item key="venda" rotulo="Venda de origem">
        <span className="inline-flex items-center gap-1.5">
          <Handshake aria-hidden className="size-3.5 shrink-0 text-fg-mute" />
          <LinkVinculado c={card.origemOportunidade} />
        </span>
      </Item>,
    );
  }
  if (itens.length === 0) return null;
  return (
    <section aria-label="Resultado" className="mb-6 rounded-xl border border-border bg-surface p-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{itens}</dl>
    </section>
  );
}
