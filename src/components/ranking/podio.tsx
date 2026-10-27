import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { EstadoVazio } from "@/components/estado-vazio";
import type { LinhaRanking } from "@/lib/ranking/calculo";
import { fmtDinheiro, fmtInteiro, plural } from "@/lib/ranking/formatar";

const ORDEM_VISUAL = [1, 0, 2]; // 2º · 1º · 3º
const ALTURA = ["md:pt-0", "md:pt-6", "md:pt-10"];

/** Pódio Top 3 (padrão "top ranking card" do ics-select, no tema escuro). */
export function Podio({ linhas, euId }: { linhas: LinhaRanking[]; euId: string }) {
  const top = linhas.slice(0, 3).filter((l) => l.pontos > 0);
  if (top.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="eyebrow">pódio</p>
        <EstadoVazio
          mascote="notebook"
          tamanho="lg"
          className="pt-2"
          titulo="Ninguém pontuou neste período ainda"
          texto="Crie cards, avance fases e feche vendas para aparecer aqui."
        />
      </section>
    );
  }
  return (
    <section aria-label="Pódio" className="grid gap-3 md:grid-cols-3 md:items-start">
      {ORDEM_VISUAL.map((i) => {
        const l = top[i];
        if (!l) return <div key={i} className="hidden md:block" />;
        const primeiro = l.posicao === 1;
        return (
          <div key={l.usuario.id} className={cn("md:order-none", i === 0 ? "order-first" : "", ALTURA[i])}>
            <div
              className={cn(
                "flex flex-col items-center rounded-xl border bg-surface px-4 py-5 text-center",
                primeiro ? "border-primary/60" : "border-border",
                l.usuario.id === euId && "ring-1 ring-primary/50",
              )}
            >
              <span className={cn("font-mono text-xs tracking-eyebrow", primeiro ? "text-primary" : "text-fg-mute")}>#{l.posicao}</span>
              <Avatar nome={l.usuario.nome} usuarioId={l.usuario.id} fotoEm={l.usuario.fotoEm} tamanho={primeiro ? "lg" : "md"} className={cn("mt-3", primeiro && "size-16 text-lg")} />
              <p className="mt-3 max-w-full truncate font-medium">
                {l.usuario.nome}
                {l.usuario.id === euId ? <span className="ml-1 text-xs text-primary">(você)</span> : null}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular">{fmtInteiro(l.pontos)}</p>
              <p className="eyebrow">pontos</p>
              <p className="mt-3 font-mono text-xs text-fg-mute tabular">
                {plural(l.ganhos, "ganho", "ganhos")} · {fmtDinheiro(l.fechado)}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
