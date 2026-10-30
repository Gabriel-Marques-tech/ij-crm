"use client";

import Link from "next/link";
import { cn } from "cn";
import { COR_ACAO, COR_ACAO_VENCIDA } from "@/components/calendario/mini-card-acao";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { rotuloDia } from "@/lib/calendario/rotulos";
import type { DiaAgrupado } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { useEditorPrazo } from "./editor-prazo";

/** Agenda lateral (~220px, como a do ICS): os itens do período agrupados por dia. */
export function Agenda({
  dias,
  hoje,
  rotulo = "Esta semana",
  vazio = "Nada nesta semana.",
}: {
  dias: DiaAgrupado<AcaoItem, PrazoItem>[];
  hoje: string;
  /** Cabeçalho: "Esta semana", "Este mês", "Próximos 15 dias"… */
  rotulo?: string;
  vazio?: string;
}) {
  const { abrir } = useEditorPrazo();
  const comItens = dias.filter((d) => d.acoes.length || d.prazos.length);
  const total = comItens.reduce((n, d) => n + d.acoes.length + d.prazos.length, 0);
  return (
    <aside className={comItens.length ? "space-y-6" : "space-y-4"}>
      <p className="eyebrow">
        {rotulo} · <span className="tabular">{total}</span> {total === 1 ? "item" : "itens"}
      </p>
      {comItens.length === 0 ? <p className="text-sm text-fg-mute">{vazio}</p> : null}
      {comItens.map(({ dia, acoes, prazos }) => {
        const r = rotuloDia(dia);
        return (
          <div key={dia} id={`agenda-${dia}`} className="scroll-mt-20 space-y-2">
            <p className={cn("font-mono text-xs font-medium", dia === hoje ? "text-primary" : "text-fg-mute")}>
              {r.semana} <span className="tabular">{r.ddmm}</span>
              {dia === hoje ? " · hoje" : ""}
            </p>
            <ul className="divide-y divide-border">
              {acoes.map((a) => (
                <li key={a.cardId}>
                  <Link href={`/projetos/${a.cardId}`} className="group flex min-h-11 items-center gap-2 rounded-md py-2.5 pr-1 transition-colors hover:bg-surface-hover">
                    <span aria-hidden className={cn("h-7 w-[3px] shrink-0 rounded-sm", a.vencida ? COR_ACAO_VENCIDA : COR_ACAO)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-relaxed text-foreground">{a.acao ?? "Próxima ação"}</span>
                      <span className="block truncate text-[11px] text-fg-mute">{a.empresa ?? a.titulo}</span>
                    </span>
                    <span className={cn("shrink-0 font-mono text-[10px]", a.vencida ? "text-primary" : "text-fg-mute")}>{a.vencida ? "vencida" : "ação"}</span>
                  </Link>
                </li>
              ))}
              {prazos.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => abrir(p)} className="flex min-h-11 w-full items-center gap-2 rounded-md py-2.5 pr-1 text-left transition-colors hover:bg-surface-hover">
                    <span aria-hidden className="w-[3px] shrink-0 text-center text-xs">
                      {p.estado === "feito" ? "✓" : "🏁"}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate pl-1 text-[13px] leading-relaxed", p.estado === "feito" ? "text-fg-faint line-through" : p.estado === "vencido" ? "text-primary" : "text-foreground")}>
                      {p.titulo}
                    </span>
                    <span className={cn("shrink-0 font-mono text-[10px]", p.estado === "vencido" ? "text-primary" : "text-fg-mute")}>
                      {p.estado === "feito" ? "feito" : p.estado === "vencido" ? "vencido" : "prazo"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
