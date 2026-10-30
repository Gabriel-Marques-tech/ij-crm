import Link from "next/link";
import { FolderKanban, Handshake } from "lucide-react";
import { formatarDataHora, formatarDinheiro } from "@/lib/projetos/formatar";
import type { DetalheCard } from "@/lib/projetos/projetos";
import { ROTULO_ALERTA_VENDA, alertaDaVenda } from "@/lib/projetos/terminal-regras";

type Vinculado = { id: string; titulo: string; deletadoEm: Date | null; pipeline: { chave: string } };

function LinkVinculado({ c }: { c: Vinculado }) {
  if (c.deletadoEm) return <span className="text-fg-mute">{c.titulo} (removido)</span>;
  return (
    <Link href={`/projetos/${c.id}`} className="text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
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
  // Reabrir mantém os campos (último fechamento): fora do terminal, rotula como anterior.
  const anteriorGanho = card.fase.tipoTerminal !== "GANHO" ? " (anterior)" : "";
  const anteriorPerda = card.fase.tipoTerminal !== "PERDIDO" ? " (anterior)" : "";
  if (card.dataGanho) {
    itens.push(
      <Item key="data" rotulo={`Ganho em${anteriorGanho}`}>
        <span className="font-mono tabular">{formatarDataHora(card.dataGanho)}</span>
      </Item>,
      <Item key="valor" rotulo={`Valor fechado${anteriorGanho}`}>
        <span className="font-mono tabular">{card.valorFechado ? formatarDinheiro(card.valorFechado.toFixed(2)) : "—"}</span>
      </Item>,
    );
  }
  if (card.motivoPerda) {
    itens.push(
      <Item key="motivo" rotulo={`Motivo da perda${anteriorPerda}`}>
        <span title={card.motivoPerda}>{card.motivoPerda}</span>
      </Item>,
    );
  }
  if (card.cardProjetos) {
    itens.push(
      <Item key="projeto" rotulo="Projeto">
        <span className="inline-flex items-center gap-1.5">
          <FolderKanban aria-hidden className="size-3.5 shrink-0 text-fg-mute" />
          <LinkVinculado c={card.cardProjetos} />
        </span>
      </Item>,
    );
  }
  if (card.vendaOrigem) {
    const alerta = alertaDaVenda(card.vendaOrigem);
    itens.push(
      <Item key="venda" rotulo="Venda de origem">
        <span className="inline-flex items-center gap-1.5">
          <Handshake aria-hidden className="size-3.5 shrink-0 text-fg-mute" />
          <LinkVinculado c={card.vendaOrigem} />
          {alerta ? (
            <span
              className="rounded-full border border-danger/60 px-1.5 font-mono text-[10px] leading-4 text-fg-soft uppercase"
              title="A venda saiu do ganho. O projeto não foi mexido: confira se ele continua."
            >
              {ROTULO_ALERTA_VENDA[alerta]}
            </span>
          ) : null}
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
