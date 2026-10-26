import Link from "next/link";
import { cn } from "cn";
import { BORDA_AGING, DiasNaFase } from "@/components/kanban/aging";
import { diaEmFuso, diasNaFase, nivelAging } from "@/lib/oportunidades/aging";
import { quandoRotulo, type FaixaSemana } from "@/lib/semana/agrupar";
import type { CardSemana } from "@/lib/semana/semana";
import { MarcarFeita } from "./marcar-feita";

const COR_FAIXA: Record<FaixaSemana, string> = { vencida: "bg-danger", hoje: "bg-warn", semana: "bg-success" };

function esperadoDe(c: CardSemana) {
  return { proximaAcao: c.proximaAcao, dia: c.proximaAcaoEm ? diaEmFuso(c.proximaAcaoEm) : null };
}

function Meta({ c, className }: { c: CardSemana; className?: string }) {
  return (
    <p className={cn("truncate font-mono text-[11px] text-fg-mute", className)}>
      {c.pipeline.nome} · {c.fase.nome}
      {c.empresa && c.empresa.nome !== c.titulo ? <span className="font-sans text-xs"> · {c.empresa.nome}</span> : null}
    </p>
  );
}

/** Padrão "Today" (§4.5.1): o item mais urgente grande, em cima. */
export function Destaque({ c, faixa, agora, hoje }: { c: CardSemana; faixa: FaixaSemana; agora: Date; hoje: string }) {
  const quando = quandoRotulo(c.proximaAcaoEm!, agora);
  const dias = diasNaFase(c.faseDesde, agora);
  return (
    <section aria-labelledby="destaque-titulo" className={cn("rounded-xl border border-l-2 border-border bg-surface p-5 md:p-6", faixa === "vencida" ? "border-l-danger" : faixa === "hoje" ? "border-l-warn" : "border-l-success")}>
      <p className="eyebrow mb-3 flex items-center gap-2">
        <span aria-hidden className={cn("size-1.5 rounded-full", COR_FAIXA[faixa])} />
        mais urgente · {faixa === "vencida" ? `vencida ${quando.curto}` : faixa === "hoje" ? "hoje" : quando.curto}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-2xl leading-tight font-semibold tracking-tight text-foreground md:text-3xl">{c.proximaAcao ?? "Próxima ação sem descrição"}</p>
          <Link id="destaque-titulo" href={`/kanban/${c.id}`} className="mt-2 inline-block text-base text-fg-soft hover:text-foreground hover:underline">
            {c.titulo}
          </Link>
          <Meta c={c} className="mt-1" />
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl text-foreground tabular">{quando.data}</p>
          <p className="font-mono text-xs text-fg-mute">{quando.curto}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <MarcarFeita cardId={c.id} esperado={esperadoDe(c)} hoje={hoje} destaque />
        <DiasNaFase dias={dias} nivel={nivelAging(dias, c.fase.limiteDiasAlerta)} />
      </div>
    </section>
  );
}

export function Linha({ c, agora, hoje }: { c: CardSemana; agora: Date; hoje: string }) {
  const dias = diasNaFase(c.faseDesde, agora);
  const nivel = nivelAging(dias, c.fase.limiteDiasAlerta);
  const quando = c.proximaAcaoEm ? quandoRotulo(c.proximaAcaoEm, agora) : null;
  const temAcao = c.proximaAcao !== null || c.proximaAcaoEm !== null;
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-l-2 border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-hover", BORDA_AGING[nivel])}>
      <div className="w-20 shrink-0 font-mono text-xs tabular">
        {quando ? (
          <>
            <span className="block text-foreground">{quando.data}</span>
            <span className="block text-[11px] text-fg-mute">{quando.curto}</span>
          </>
        ) : (
          <span className="text-fg-faint">—</span>
        )}
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <Link href={`/kanban/${c.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
          {c.titulo}
        </Link>
        <Meta c={c} />
      </div>
      <p className={cn("min-w-0 flex-1 basis-48 text-sm", c.proximaAcao ? "text-fg-soft" : "text-fg-faint")}>{c.proximaAcao ?? (temAcao ? "sem descrição" : "sem próxima ação")}</p>
      <DiasNaFase dias={dias} nivel={nivel} />
      <div className="flex w-full justify-end sm:w-auto">
        <MarcarFeita cardId={c.id} esperado={esperadoDe(c)} hoje={hoje} modo={temAcao ? "feita" : "definir"} />
      </div>
    </li>
  );
}

export function Grupo({
  titulo,
  total,
  cor,
  itens,
  vazio,
  agora,
  hoje,
}: {
  titulo: string;
  total: number;
  cor: string;
  itens: CardSemana[];
  vazio: React.ReactNode;
  agora: Date;
  hoje: string;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span aria-hidden className={cn("size-1.5 rounded-full", cor)} />
        {titulo}
        <span className="font-mono text-xs text-fg-mute tabular">{total}</span>
      </h2>
      {itens.length ? (
        <ul className="space-y-2">
          {itens.map((c) => (
            <Linha key={c.id} c={c} agora={agora} hoje={hoje} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-fg-mute">{vazio}</p>
      )}
    </section>
  );
}
