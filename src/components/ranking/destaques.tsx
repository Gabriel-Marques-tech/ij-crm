import Link from "next/link";
import { Avatar } from "@/components/avatar";
import type { Destaque } from "@/lib/ranking/calculo";
import { fmtDestaque, TRACO } from "@/lib/ranking/formatar";

/** Líderes do período: avatar + valor; empates mostram todos; sem dados, "—" com o mínimo. */
export function Destaques({ destaques }: { destaques: Destaque[] }) {
  return (
    <section aria-label="Destaques do período" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {destaques.map((d) => (
        <div key={d.chave} className="rounded-xl border border-border bg-surface p-4">
          <p className="eyebrow">{d.titulo}</p>
          {d.vencedores.length === 0 ? (
            <>
              <p className="mt-2 font-mono text-xl text-fg-mute">{TRACO}</p>
              <p className="mt-1 text-xs text-fg-faint">{d.dica}</p>
            </>
          ) : (
            <>
              <p className="mt-2 font-mono text-xl font-semibold tabular">{fmtDestaque(d.formato, d.valor)}</p>
              <ul className="mt-2 space-y-1.5">
                {d.vencedores.map((v) => (
                  <li key={`${v.usuario.id}-${v.card?.id ?? ""}`} className="flex items-center gap-2 text-sm">
                    <Avatar nome={v.usuario.nome} usuarioId={v.usuario.id} fotoEm={v.usuario.fotoEm} tamanho="xs" />
                    <span className="min-w-0 truncate">
                      {v.usuario.nome}
                      {v.card ? (
                        <>
                          {" · "}
                          <Link href={`/projetos/${encodeURIComponent(v.card.id)}`} className="text-fg-mute hover:text-foreground hover:underline">
                            {v.card.titulo}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {d.vencedores.length > 1 ? <p className="mt-1.5 font-mono text-[11px] text-fg-faint">empate</p> : null}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
