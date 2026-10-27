import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import type { Periodo, PeriodoCalendario } from "@/lib/calendario/periodo";

const SETA = "inline-flex size-8 items-center justify-center rounded-lg text-fg-soft transition-colors hover:bg-surface-hover hover:text-foreground";
const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";

const NOME: Record<Periodo, { anterior: string; proxima: string }> = {
  semana: { anterior: "Semana anterior", proxima: "Próxima semana" },
  "15d": { anterior: "15 dias anteriores", proxima: "Próximos 15 dias" },
  mes: { anterior: "Mês anterior", proxima: "Próximo mês" },
};

/** ‹ Hoje › (ICS: "Today" + setas), andando pelo período escolhido. `href(ref)` mantém os outros filtros; null = período atual. */
export function NavPeriodo({ periodo, href }: { periodo: PeriodoCalendario; href: (ref: string | null) => string }) {
  const nome = NOME[periodo.periodo];
  return (
    <div className="flex items-center gap-1">
      <Link
        href={href(null)}
        aria-current={periodo.atual ? "date" : undefined}
        className={cn("inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-surface-hover hover:text-foreground", periodo.atual ? "text-fg-mute" : "text-fg-soft")}
      >
        Hoje
      </Link>
      <Link href={href(periodo.anterior)} className={SETA} aria-label={nome.anterior}>
        <ChevronLeft className="size-4" />
      </Link>
      <Link href={href(periodo.proxima)} className={SETA} aria-label={nome.proxima}>
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

const OPCOES: { valor: Periodo; rotulo: string }[] = [
  { valor: "semana", rotulo: "Semana" },
  { valor: "15d", rotulo: "15 dias" },
  { valor: "mes", rotulo: "Mês" },
];

/** Semana | 15 dias | Mês. Trocar de período volta para o período atual. */
export function SeletorPeriodo({ atual, href }: { atual: Periodo; href: (p: Periodo) => string }) {
  return (
    <nav aria-label="Período" className="flex items-center rounded-lg border border-border bg-surface p-0.5">
      {OPCOES.map((o) => (
        <Link
          key={o.valor}
          href={href(o.valor)}
          aria-current={atual === o.valor ? "page" : undefined}
          className={cn(ABA, atual === o.valor ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}
        >
          {o.rotulo}
        </Link>
      ))}
    </nav>
  );
}
