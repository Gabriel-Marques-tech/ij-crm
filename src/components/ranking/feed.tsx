import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { FUSO_NEGOCIO } from "@/lib/projetos/aging";
import type { ItemFeed } from "@/lib/ranking/calculo";

const QUANDO = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_NEGOCIO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Feed "últimos 7 dias" (padrão "cohort feed"): ganhos e avanços — só título do card, sem valores. */
export function FeedRanking({ itens, vazio }: { itens: ItemFeed[]; vazio: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <p className="eyebrow mb-3">últimos 7 dias</p>
      {itens.length === 0 ? (
        <p className="text-sm text-fg-mute">{vazio}</p>
      ) : (
        <ul className="space-y-3">
          {itens.map((i) => (
            <li key={`${i.tipo}-${i.projetoId}-${i.em.getTime()}`} className="flex gap-3 text-sm">
              <Avatar nome={i.usuario.nome} usuarioId={i.usuario.id} fotoEm={i.usuario.fotoEm} tamanho="xs" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-fg-soft">
                  <span className="font-medium text-foreground">{i.usuario.nome.split(" ")[0]}</span>{" "}
                  {i.tipo === "GANHO" ? (
                    <>
                      <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-success align-middle" />
                      ganhou{" "}
                    </>
                  ) : (
                    "avançou "
                  )}
                  <Link href={`/projetos/${encodeURIComponent(i.projetoId)}`} className="text-foreground hover:underline">
                    {i.titulo}
                  </Link>
                  {i.tipo === "AVANCO" && i.faseNome ? <span className="text-fg-mute"> → {i.faseNome}</span> : null}
                </p>
                <p className="font-mono text-[11px] text-fg-faint">{QUANDO.format(i.em).replace(",", "")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
