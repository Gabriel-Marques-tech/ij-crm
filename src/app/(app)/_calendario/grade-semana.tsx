"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "cn";
import { LinhaChegada } from "@/components/calendario/linha-chegada";
import { MiniCardAcao } from "@/components/calendario/mini-card-acao";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { rotuloDia } from "@/lib/calendario/rotulos";
import type { DiaAgrupado } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { useEditorPrazo } from "./editor-prazo";


/**
 * Semana em 7 colunas (GAB-51), estrutura da grade do ICS sem a régua de
 * horas: cada célula empilha as próximas ações (mini-cards), um espaço vazio
 * que cria prazo naquele dia e, no pé, os prazos 🏁.
 *
 * `rolagem` (Calendário): 7 colunas sempre, min 840px, rolagem horizontal no
 * celular (como o ICS). `empilhar` (Minha Semana): no celular os dias viram
 * uma lista vertical.
 */
export function GradeSemana({
  dias,
  hoje,
  layout = "rolagem",
  mostrarResponsavelNoPrazo = false,
  extraDaAcao,
  urgenteId = null,
}: {
  dias: DiaAgrupado<AcaoItem, PrazoItem>[];
  hoje: string;
  layout?: "rolagem" | "empilhar";
  mostrarResponsavelNoPrazo?: boolean;
  /** Ex.: "marcar feita" na Minha Semana. */
  extraDaAcao?: (a: AcaoItem) => ReactNode;
  /** Card "Mais urgente" da Minha Semana: marcado no mini-card. */
  urgenteId?: string | null;
}) {
  const { novo, abrir } = useEditorPrazo();
  const empilhar = layout === "empilhar";
  return (
    <div data-testid="grade-semana" className={empilhar ? "md:overflow-x-auto" : "overflow-x-auto"}>
      <div className={empilhar ? "md:min-w-[840px]" : "min-w-[840px]"}>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className={cn("grid-cols-7 border-b border-border", empilhar ? "hidden md:grid" : "grid")}>
            {dias.map(({ dia }) => {
              const r = rotuloDia(dia);
              const ehHoje = dia === hoje;
              return (
                <div key={dia} className="flex items-center justify-center gap-2 py-3 font-mono text-[11px] tracking-eyebrow text-fg-mute uppercase">
                  <span>{r.semana}</span>
                  <span
                    aria-current={ehHoje ? "date" : undefined}
                    className={cn("inline-flex size-6 items-center justify-center rounded-full text-[13px] tabular", ehHoje ? "bg-primary font-semibold text-primary-foreground" : "text-foreground")}
                  >
                    {r.numero}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={cn("grid", empilhar ? "grid-cols-1 md:grid-cols-7" : "grid-cols-7")}>
            {dias.map(({ dia, acoes, prazos }, i) => {
              const r = rotuloDia(dia);
              const ehHoje = dia === hoje;
              return (
                <section
                  key={dia}
                  aria-label={`${r.semana} ${r.ddmm}`}
                  data-dia={dia}
                  className={cn(
                    "flex min-w-0 flex-col gap-1.5 p-1.5",
                    empilhar ? "min-h-0 border-t border-border first:border-t-0 md:min-h-80 md:border-t-0" : "min-h-80",
                    i > 0 && (empilhar ? "md:border-l md:border-border" : "border-l border-border"),
                    ehHoje && "bg-primary-soft/10",
                  )}
                >
                  {empilhar ? (
                    <p className={cn("flex items-center gap-2 px-1 pt-1 font-mono text-[11px] tracking-eyebrow uppercase md:hidden", ehHoje ? "text-primary" : "text-fg-mute")}>
                      {r.semana} <span className="tabular">{r.ddmm}</span>
                      {ehHoje ? <span className="normal-case">· hoje</span> : null}
                    </p>
                  ) : null}
                  {acoes.map((a) => (
                    <MiniCardAcao key={a.cardId} item={a} extra={extraDaAcao?.(a)} urgente={a.cardId === urgenteId} />
                  ))}
                  <button
                    type="button"
                    onClick={() => novo(dia)}
                    aria-label={`Novo prazo em ${r.ddmm}`}
                    className={cn(
                      "group flex flex-1 items-center justify-center rounded-md text-fg-faint outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50",
                      empilhar ? "min-h-8" : "min-h-10",
                    )}
                  >
                    <Plus className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                  {prazos.length ? (
                    <div className="space-y-0.5">
                      {prazos.map((p) => (
                        <LinhaChegada key={p.id} prazo={p} onAbrir={abrir} mostrarResponsavel={mostrarResponsavelNoPrazo} />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
