import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Peças visuais da área G&G (e da equipe do projeto), no desenho do automacao-GG
 * — tiles com o primeiro em destaque, painéis com cabeçalho e contagem, abas em
 * botão — sobre os tokens do CRM.
 */

/** Campo nativo (select/input/date) no mesmo visual do `Input`. */
export const CAMPO =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [color-scheme:light] dark:[color-scheme:dark]";

export function Painel({ titulo, contagem, acoes, children, className }: { titulo?: ReactNode; contagem?: number; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface", className)}>
      {titulo ? (
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {contagem !== undefined ? <span className="rounded border border-border-strong px-1.5 font-mono text-[11px] text-fg-mute tabular">{contagem}</span> : null}
          <span className="flex-1" />
          {acoes}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*:first-child]:border-primary/40 [&>*:first-child]:bg-primary-soft/40 [&>*:first-child_.valor]:text-primary">{children}</div>;
}

export function Tile({ rotulo, valor, nota }: { rotulo: string; valor: ReactNode; nota?: string }) {
  return (
    <div className="grid content-start gap-2 rounded-xl border border-border bg-surface px-4 py-3.5">
      <span className="text-sm text-fg-mute">{rotulo}</span>
      <span className="valor text-2xl font-semibold leading-none tabular">{valor}</span>
      {nota ? <span className="text-xs text-fg-faint">{nota}</span> : null}
    </div>
  );
}

const TOM = {
  neutro: "border-border-strong text-fg-mute",
  coral: "border-primary/40 bg-primary-soft text-primary",
  azul: "border-chart-4/40 text-chart-4",
  gg: "border-chart-5/40 text-chart-5",
  ok: "border-success/40 text-success",
  aviso: "border-warn/40 text-warn",
  perigo: "border-danger/40 text-danger",
} as const;
export type Tom = keyof typeof TOM;

export function Chip({ tom = "neutro", children, className }: { tom?: Tom; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-none", TOM[tom], className)}>{children}</span>;
}

/** Tabela no padrão das listas do CRM (cabeçalho mono, linhas finas, rola de lado no celular). */
export function Tabela({ colunas, children, vazio }: { colunas: string[]; children: ReactNode; vazio?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {colunas.map((c) => (
              <th key={c} className="eyebrow px-4 py-2.5 font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border/60 [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-2.5">{children}</tbody>
      </table>
      {vazio ? <p className="px-4 py-6 text-sm text-fg-faint">{vazio}</p> : null}
    </div>
  );
}

/** Dia `YYYY-MM-DD` → `05/11/2026`. */
export const diaBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
