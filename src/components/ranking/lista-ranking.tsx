import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import type { LinhaRanking } from "@/lib/ranking/calculo";
import { fmtDinheiro, fmtInteiro } from "@/lib/ranking/formatar";

/** Lista completa (padrão "cohort roster"): posição, avatar, nome, pontos, ganhos, R$ fechado. */
export function ListaRanking({ linhas, euId }: { linhas: LinhaRanking[]; euId: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <p className="eyebrow">classificação</p>
        <p className="font-mono text-xs text-fg-mute">{linhas.length} no time</p>
      </header>
      <ol>
        {linhas.map((l) => {
          const voce = l.usuario.id === euId;
          return (
            <li
              key={l.usuario.id}
              aria-current={voce ? "true" : undefined}
              className={cn("flex items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0", voce && "border-l-2 border-l-primary bg-primary-soft/40")}
            >
              <span className="w-7 shrink-0 font-mono text-sm text-fg-mute tabular">{l.posicao}º</span>
              <Avatar nome={l.usuario.nome} usuarioId={l.usuario.id} fotoEm={l.usuario.fotoEm} tamanho="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {l.usuario.nome}
                {voce ? <span className="ml-1.5 font-mono text-[11px] uppercase tracking-eyebrow text-primary">você</span> : null}
              </span>
              <span className="hidden w-20 text-right font-mono text-xs text-fg-mute tabular sm:block">{l.ganhos} ganho{l.ganhos === 1 ? "" : "s"}</span>
              <span className="hidden w-32 text-right font-mono text-xs text-fg-mute tabular md:block">{fmtDinheiro(l.fechado)}</span>
              <span className="w-16 text-right font-mono text-sm font-semibold tabular">{fmtInteiro(l.pontos)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
