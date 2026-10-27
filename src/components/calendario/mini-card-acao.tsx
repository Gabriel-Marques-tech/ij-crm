import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Avatar } from "@/components/kanban/avatar";
import type { AcaoItem } from "@/lib/calendario/calendario";

/** Cor da barra de "ação" (legenda): azul da paleta; vencida = coral. */
export const COR_ACAO = "bg-chart-4";
export const COR_ACAO_VENCIDA = "bg-primary";

/**
 * Próxima ação no Calendário/Minha Semana (GAB-51): mini-card no estilo do
 * Kanban. O card inteiro é o link (pseudo-elemento); `extra` (ex.: marcar
 * feita) fica por cima dele.
 */
export function MiniCardAcao({ item, extra }: { item: AcaoItem; extra?: ReactNode }) {
  const vencida = item.vencida;
  return (
    <article
      data-estado={vencida ? "vencida" : "normal"}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-surface py-2 pr-2 pl-3 transition-colors hover:bg-surface-hover",
        vencida ? "border-primary/40 bg-primary-soft/30 hover:bg-primary-soft/45" : "border-border",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", vencida ? COR_ACAO_VENCIDA : COR_ACAO)} />
      <Link
        href={`/kanban/${item.cardId}`}
        className="line-clamp-2 text-xs leading-snug font-medium text-foreground outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
      >
        {item.acao ?? "Próxima ação"}
      </Link>
      <p className="mt-0.5 truncate text-[11px] text-fg-mute">{item.empresa ?? item.titulo}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-[10px] text-fg-faint">
          {vencida ? <span className="text-primary">vencida · </span> : null}
          {item.fase}
        </span>
        <span className="flex-1" />
        {extra ? <span className="relative z-10">{extra}</span> : null}
        <Avatar nome={item.responsavel.nome} usuarioId={item.responsavel.id} fotoEm={item.responsavel.fotoEm} className="size-5 text-[9px]" />
      </div>
    </article>
  );
}
