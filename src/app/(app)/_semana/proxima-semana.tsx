"use client";

import Link from "next/link";
import { cn } from "cn";
import { COR_ACAO } from "@/components/calendario/mini-card-acao";
import type { AcaoItem } from "@/lib/calendario/calendario";
import { rotuloDia } from "@/lib/calendario/rotulos";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { useEditorPrazo } from "../_calendario/editor-prazo";

type Linha = { tipo: "acao"; dia: string; a: AcaoItem } | { tipo: "prazo"; dia: string; p: PrazoItem };

/**
 * Lista compacta sob as colunas (GAB-51): da segunda seguinte até hoje+7, o
 * que antes ficava em "Próximos 7 dias" e não cabe na semana atual.
 */
export function ProximaSemana({ acoes, prazos, ate, depois, kanbanHref }: { acoes: AcaoItem[]; prazos: PrazoItem[]; ate: string; depois: number; kanbanHref: string }) {
  const { abrir } = useEditorPrazo();
  const linhas: Linha[] = [...prazos.map((p): Linha => ({ tipo: "prazo", dia: p.dia, p })), ...acoes.map((a): Linha => ({ tipo: "acao", dia: a.dia, a }))].sort((x, y) =>
    x.dia < y.dia ? -1 : x.dia > y.dia ? 1 : x.tipo === y.tipo ? 0 : x.tipo === "prazo" ? -1 : 1,
  );
  const ateRotulo = rotuloDia(ate).ddmm;
  return (
    <section aria-labelledby="proxima-semana" className="mt-6">
      <h3 id="proxima-semana" className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        Próxima semana
        <span className="font-mono text-xs text-fg-mute tabular">{linhas.length}</span>
      </h3>
      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-fg-mute">Nada na próxima semana até {ateRotulo}.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {linhas.map((l) => {
            const r = rotuloDia(l.dia);
            const data = <span className="w-20 shrink-0 font-mono text-[11px] text-fg-mute tabular">{`${r.semana} ${r.ddmm}`}</span>;
            return l.tipo === "acao" ? (
              <li key={`a-${l.a.cardId}`}>
                <Link href={`/kanban/${l.a.cardId}`} className="flex min-h-10 items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-hover">
                  {data}
                  <span aria-hidden className={cn("h-5 w-[3px] shrink-0 rounded-sm", COR_ACAO)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{l.a.acao ?? "Próxima ação"}</span>
                  <span className="hidden max-w-48 truncate text-xs text-fg-mute sm:block">{l.a.empresa ?? l.a.titulo}</span>
                </Link>
              </li>
            ) : (
              <li key={`p-${l.p.id}`}>
                <button type="button" onClick={() => abrir(l.p)} className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover">
                  {data}
                  <span aria-hidden className="w-[3px] shrink-0 text-xs">
                    {l.p.estado === "feito" ? "✓" : "🏁"}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", l.p.estado === "feito" ? "text-fg-faint line-through" : "text-foreground")}>{l.p.titulo}</span>
                  <span className="font-mono text-[10px] text-fg-mute">prazo</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {depois > 0 ? (
        <p className="mt-2 font-mono text-xs text-fg-mute">
          +{depois} {depois === 1 ? "card" : "cards"} com próxima ação depois de {ateRotulo} ·{" "}
          <Link href={kanbanHref} className="text-fg-soft hover:text-foreground hover:underline">
            ver no Kanban
          </Link>
        </p>
      ) : null}
    </section>
  );
}
