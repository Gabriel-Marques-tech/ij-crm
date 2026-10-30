import Link from "next/link";
import { cn } from "cn";
import { BORDA_AGING, DiasNaFase } from "@/components/kanban/aging";
import { Avatar } from "@/components/kanban/avatar";
import { diasNaFase, estadoProximaAcao, nivelAging } from "@/lib/projetos/aging";
import type { CardCliente, FaseCliente } from "./tipos";

/** Card do Kanban (§4.5.1): surface sobre bg, borda; aging só no dot e na borda esquerda. */
export function CardVisual({
  card,
  fase,
  agoraMs,
  arrastando = false,
}: {
  card: CardCliente;
  fase: FaseCliente | undefined;
  agoraMs: number;
  arrastando?: boolean;
}) {
  const agora = new Date(agoraMs);
  const dias = diasNaFase(new Date(Math.min(card.faseDesdeMs, agoraMs)), agora);
  const nivel = nivelAging(dias, fase?.limiteDiasAlerta ?? null);
  const acao = estadoProximaAcao(card.proximaAcaoEmMs === null ? null : new Date(card.proximaAcaoEmMs), agora);
  const mostrarAcao = acao === "vencida" || acao === "hoje";

  return (
    <article
      className={cn(
        "rounded-lg border border-l-2 border-border bg-surface p-3 transition-colors hover:bg-surface-hover",
        BORDA_AGING[nivel],
        arrastando && "rotate-1 border-border-strong shadow-lg shadow-black/40",
      )}
    >
      <Link
        href={`/projetos/${card.id}`}
        className="block text-sm leading-snug font-medium text-foreground outline-none hover:underline focus-visible:underline"
        // Não deixa o clique no link iniciar arrasto por teclado no card pai.
        onKeyDown={(e) => e.stopPropagation()}
      >
        {card.titulo}
      </Link>
      {card.empresaNome && card.empresaNome !== card.titulo ? <p className="mt-0.5 truncate text-xs text-fg-mute">{card.empresaNome}</p> : null}
      {card.descricaoPrevia ? (
        // Texto puro (sem HTML/markdown), preso em 2 linhas para o card não crescer.
        <p data-testid="previa-descricao" className="mt-1 line-clamp-2 text-xs leading-snug break-words whitespace-pre-line text-fg-mute">
          {card.descricaoTruncada ? `${card.descricaoPrevia}…` : card.descricaoPrevia}
        </p>
      ) : null}

      {mostrarAcao ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-soft">
          <span aria-hidden className={cn("mt-1 size-1.5 shrink-0 rounded-full", acao === "vencida" ? "bg-danger" : "bg-warn")} />
          <span className="min-w-0">
            <span className="font-mono text-[11px] text-fg-mute">{acao === "vencida" ? "vencida" : "hoje"}</span>
            {card.proximaAcao ? <> · {card.proximaAcao}</> : null}
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <DiasNaFase dias={dias} nivel={nivel} />
        {card.revisar ? (
          <span className="rounded-full border border-warn/60 px-1.5 font-mono text-[10px] leading-4 text-fg-soft uppercase">revisar</span>
        ) : null}
        <span className="flex-1" />
        <Avatar nome={card.responsavelNome} usuarioId={card.responsavelId} fotoEm={card.responsavelFotoEm} />
      </div>
    </article>
  );
}
