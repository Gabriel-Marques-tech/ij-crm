import { formatarDataHora, formatarDinheiro } from "@/lib/projetos/formatar";
import type { DetalheCard } from "@/lib/projetos/projetos";
import { PIPELINE_PROJETOS } from "@/lib/projetos/terminal-regras";

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

/**
 * Resultado do card (GAB-32): ganho (valor fechado, data) ou perda (motivo).
 * Só leitura: muda movendo de fase. Nada a mostrar → nada.
 */
export function ResultadoTerminal({ card }: { card: DetalheCard }) {
  const itens: React.ReactNode[] = [];
  // Reabrir mantém os campos (último fechamento): fora do terminal, rotula como anterior.
  // No quadro Projetos o card está ganho (Ganho → Handoff, GAB-81).
  const anteriorGanho = card.fase.tipoTerminal !== "GANHO" && card.pipeline.chave !== PIPELINE_PROJETOS ? " (anterior)" : "";
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
  if (itens.length === 0) return null;
  return (
    <section aria-label="Resultado" className="mb-6 rounded-xl border border-border bg-surface p-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{itens}</dl>
    </section>
  );
}
