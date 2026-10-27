import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import type { SemanaCalendario } from "@/lib/calendario/semana";

const SETA = "inline-flex size-8 items-center justify-center rounded-lg text-fg-soft transition-colors hover:bg-surface-hover hover:text-foreground";

/** ‹ Hoje › (ICS: "Today" + setas). `href(semana)` monta a URL mantendo os outros filtros; null = semana atual. */
export function NavSemana({ semana, href }: { semana: SemanaCalendario; href: (segunda: string | null) => string }) {
  return (
    <div className="flex items-center gap-1">
      <Link
        href={href(null)}
        aria-current={semana.atual ? "date" : undefined}
        className={cn("inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-surface-hover hover:text-foreground", semana.atual ? "text-fg-mute" : "text-fg-soft")}
      >
        Hoje
      </Link>
      <Link href={href(semana.anterior)} className={SETA} aria-label="Semana anterior">
        <ChevronLeft className="size-4" />
      </Link>
      <Link href={href(semana.proxima)} className={SETA} aria-label="Próxima semana">
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
