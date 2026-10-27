import Link from "next/link";
import { Avatar } from "@/components/avatar";
import type { Top3 } from "@/lib/ranking/servico";
import { fmtInteiro } from "@/lib/ranking/formatar";

/** Card lateral da Minha Semana: Top 3 da semana atual (ou só os próprios pontos, se o ranking estiver oculto). */
export function Top3Semana({ dados, euId }: { dados: Top3; euId: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="eyebrow">{dados.modo === "completo" ? "top 3 da semana" : "seus pontos na semana"}</p>
        <Link href="/ranking" className="font-mono text-xs text-fg-mute hover:text-foreground hover:underline">
          ranking →
        </Link>
      </div>
      {dados.modo === "completo" ? (
        dados.top.length === 0 ? (
          <p className="text-sm text-fg-mute">Ninguém pontuou nesta semana ainda.</p>
        ) : (
          <ol className="space-y-2.5">
            {dados.top.map((l) => (
              <li key={l.usuario.id} className="flex items-center gap-2.5 text-sm">
                <span className="w-5 font-mono text-xs text-fg-mute">{l.posicao}º</span>
                <Avatar nome={l.usuario.nome} usuarioId={l.usuario.id} fotoEm={l.usuario.fotoEm} tamanho="xs" />
                <span className="min-w-0 flex-1 truncate">
                  {l.usuario.nome}
                  {l.usuario.id === euId ? <span className="ml-1 text-xs text-primary">(você)</span> : null}
                </span>
                <span className="font-mono font-semibold tabular">{fmtInteiro(l.pontos)}</span>
              </li>
            ))}
          </ol>
        )
      ) : null}
      {dados.eu && (dados.modo === "proprio" || !dados.top.some((l) => l.usuario.id === euId)) ? (
        <p className="mt-3 flex items-baseline justify-between border-t border-border pt-3 text-sm text-fg-soft">
          <span>{dados.modo === "completo" && "posicao" in dados.eu ? `Você · ${dados.eu.posicao}º` : "Você"}</span>
          <span className="font-mono font-semibold tabular text-foreground">{fmtInteiro(dados.eu.pontos)} pts</span>
        </p>
      ) : null}
    </section>
  );
}
