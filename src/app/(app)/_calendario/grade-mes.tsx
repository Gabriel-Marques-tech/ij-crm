"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/kanban/avatar";
import { COR_ACAO, COR_ACAO_VENCIDA } from "@/components/calendario/mini-card-acao";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { rotuloDia } from "@/lib/calendario/rotulos";
import type { DiaAgrupado } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { useEditorPrazo } from "./editor-prazo";

const SEMANA = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

/** Itens por célula antes do "+N" (prazos primeiro, depois ações). */
export const MAX_POR_DIA = 3;
/** Pontinhos por célula no celular antes do "+N". */
export const MAX_PONTOS = 6;

/**
 * Grade mensal (mês e 15 dias): semanas em linhas, seg–dom em colunas. Dias
 * fora do período ficam apagados e sem itens. Cada célula mostra até
 * `MAX_POR_DIA` itens compactos (🏁 prazo, ação com a barra da legenda) e
 * "+N" expande a célula; o espaço vazio cria prazo naquele dia.
 *
 * No celular a célula vira número + pontinhos (sem rolagem horizontal) e
 * leva ao dia na agenda, que fica acima da grade.
 */
export function GradeMes({
  dias,
  hoje,
  inicio,
  fim,
  mostrarResponsavel = false,
}: {
  /** A grade inteira (semanas completas), na ordem. */
  dias: DiaAgrupado<AcaoItem, PrazoItem>[];
  hoje: string;
  /** Período visível, `YYYY-MM-DD` inclusivos; o resto da grade fica apagado. */
  inicio: string;
  fim: string;
  mostrarResponsavel?: boolean;
}) {
  const { novo, abrir } = useEditorPrazo();
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (dia: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (!n.delete(dia)) n.add(dia);
      return n;
    });

  return (
    <div data-testid="grade-mes" className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border">
        {SEMANA.map((s) => (
          <div key={s} className="py-2 text-center font-mono text-[10px] tracking-eyebrow text-fg-mute uppercase md:text-[11px]">
            {s}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map(({ dia, acoes, prazos }, i) => {
          const r = rotuloDia(dia);
          const ehHoje = dia === hoje;
          const dentro = inicio <= dia && dia <= fim;
          const total = prazos.length + acoes.length;
          const aberto = abertos.has(dia);
          const limite = aberto ? Infinity : total > MAX_POR_DIA ? MAX_POR_DIA - 1 : MAX_POR_DIA;
          const prazosVis = prazos.slice(0, limite);
          const acoesVis = acoes.slice(0, Math.max(0, limite - prazosVis.length));
          const resto = total - prazosVis.length - acoesVis.length;
          const pontos = [
            ...prazos.map((p) => ({ k: `p-${p.id}`, cls: cn("rounded-[1px]", p.estado === "vencido" ? "bg-primary" : p.estado === "feito" ? "bg-fg-faint" : "bg-fg-soft") })),
            ...acoes.map((a) => ({ k: `a-${a.cardId}`, cls: cn("rounded-full", a.vencida ? COR_ACAO_VENCIDA : COR_ACAO) })),
          ];
          const pontosVis = pontos.length > MAX_PONTOS ? pontos.slice(0, MAX_PONTOS - 1) : pontos;
          return (
            <section
              key={dia}
              aria-label={`${r.semana} ${r.ddmm}`}
              data-dia={dia}
              data-fora={dentro ? undefined : ""}
              className={cn(
                "group flex min-h-14 min-w-0 flex-col gap-0.5 p-1 md:min-h-28",
                i % 7 > 0 && "border-l border-border",
                i >= 7 && "border-t border-border",
                ehHoje && "bg-primary-soft/10",
                !dentro && "bg-background/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  aria-current={ehHoje ? "date" : undefined}
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full font-mono text-[12px] tabular",
                    ehHoje ? "bg-primary font-semibold text-primary-foreground" : dentro ? "text-foreground" : "text-fg-faint",
                  )}
                >
                  {r.numero}
                </span>
                {dentro ? (
                  <button
                    type="button"
                    onClick={() => novo(dia)}
                    aria-label={`Novo prazo em ${r.ddmm}`}
                    className="hidden size-5 items-center justify-center rounded text-fg-faint opacity-0 outline-none transition-opacity group-hover:opacity-100 hover:bg-surface-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 md:inline-flex"
                  >
                    <Plus className="size-3" aria-hidden />
                  </button>
                ) : null}
              </div>

              {/* Celular: pontinhos que levam ao dia na agenda. */}
              {total > 0 ? (
                <a href={`#agenda-${dia}`} aria-label={`${total} ${total === 1 ? "item" : "itens"} em ${r.ddmm}`} className="flex flex-wrap items-center gap-0.5 px-0.5 md:hidden">
                  {pontosVis.map((d) => (
                    <span key={d.k} data-ponto aria-hidden className={cn("size-1.5", d.cls)} />
                  ))}
                  {pontos.length > pontosVis.length ? (
                    <span aria-hidden className="font-mono text-[9px] leading-none text-fg-mute">
                      +{pontos.length - pontosVis.length}
                    </span>
                  ) : null}
                </a>
              ) : null}

              <div className="hidden min-w-0 flex-1 flex-col gap-0.5 md:flex">
                {prazosVis.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-estado={p.estado}
                    onClick={() => abrir(p)}
                    title={`${p.titulo} · ${p.responsavel.nome}`}
                    className={cn(
                      "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50",
                      p.estado === "vencido" ? "text-primary" : p.estado === "feito" ? "text-fg-faint" : "text-fg-soft",
                    )}
                  >
                    <span aria-hidden className="shrink-0">
                      {p.estado === "feito" ? "✓" : "🏁"}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate font-medium", p.estado === "feito" && "line-through")}>{p.titulo}</span>
                    {mostrarResponsavel ? <Avatar nome={p.responsavel.nome} usuarioId={p.responsavel.id} fotoEm={p.responsavel.fotoEm} className="size-4 text-[8px]" /> : null}
                  </button>
                ))}
                {acoesVis.map((a) => (
                  <Link
                    key={a.cardId}
                    href={`/kanban/${a.cardId}`}
                    data-estado={a.vencida ? "vencida" : "normal"}
                    title={`${a.acao ?? "Próxima ação"} · ${a.empresa ?? a.titulo} · ${a.responsavel.nome}`}
                    className={cn(
                      "relative flex min-w-0 items-center gap-1 overflow-hidden rounded border py-0.5 pr-1 pl-2 text-[11px] leading-tight transition-colors",
                      a.vencida ? "border-primary/40 bg-primary-soft/30 hover:bg-primary-soft/45" : "border-border bg-surface hover:bg-surface-hover",
                    )}
                  >
                    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", a.vencida ? COR_ACAO_VENCIDA : COR_ACAO)} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{a.acao ?? a.empresa ?? a.titulo}</span>
                    {mostrarResponsavel ? <Avatar nome={a.responsavel.nome} usuarioId={a.responsavel.id} fotoEm={a.responsavel.fotoEm} className="size-4 text-[8px]" /> : null}
                  </Link>
                ))}
                {total > MAX_POR_DIA ? (
                  <button
                    type="button"
                    onClick={() => alternar(dia)}
                    aria-expanded={aberto}
                    aria-label={aberto ? `Recolher ${r.ddmm}` : `Mostrar mais ${resto} ${resto === 1 ? "item" : "itens"} em ${r.ddmm}`}
                    className="rounded px-1 py-0.5 text-left font-mono text-[10px] text-fg-mute outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {aberto ? "Recolher" : `+${resto} ${resto === 1 ? "item" : "itens"}`}
                  </button>
                ) : null}
                {dentro ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => novo(dia)}
                    className="min-h-3 flex-1 rounded outline-none hover:bg-surface-hover"
                  />
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
