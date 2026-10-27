import { cn } from "cn";
import { Avatar } from "@/components/kanban/avatar";
import type { PrazoItem } from "@/lib/prazos/prazos";
import type { EstadoPrazo } from "@/lib/prazos/regras";

const ROTULO: Record<EstadoPrazo, string> = { pendente: "prazo", vencido: "prazo vencido", feito: "prazo feito" };

/** Faixa quadriculada da "linha de chegada" (também usada na legenda). */
export function FaixaChegada({ estado, className }: { estado: EstadoPrazo; className?: string }) {
  return (
    <span
      aria-hidden
      data-faixa
      className={cn(
        "chegada block h-2 rounded-[2px] border",
        estado === "vencido" ? "border-primary/60 [--chegada:var(--primary)]" : estado === "feito" ? "border-border opacity-50 [--chegada:var(--fg-faint)]" : "border-border-strong",
        className,
      )}
    />
  );
}

/**
 * Prazo como "linha de chegada" 🏁 (GAB-51): nome em cima, faixa quadriculada
 * embaixo, no pé da célula do dia. Vencido e não feito → coral; feito → apagado
 * com ✓. Clicar abre o editor.
 */
export function LinhaChegada({ prazo, onAbrir, mostrarResponsavel = false }: { prazo: PrazoItem; onAbrir: (p: PrazoItem) => void; mostrarResponsavel?: boolean }) {
  const { estado } = prazo;
  return (
    <button
      type="button"
      data-estado={estado}
      onClick={() => onAbrir(prazo)}
      aria-label={`${prazo.titulo} (${ROTULO[estado]}, ${prazo.responsavel.nome})`}
      className="group block w-full rounded-md px-1 pt-1 pb-1.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        className={cn(
          "flex items-center gap-1 text-[11px] leading-tight",
          estado === "vencido" ? "text-primary" : estado === "feito" ? "text-fg-faint" : "text-fg-soft",
        )}
      >
        <span aria-hidden className="shrink-0">
          {estado === "feito" ? "✓" : "🏁"}
        </span>
        <span className={cn("min-w-0 flex-1 truncate font-medium", estado === "feito" && "line-through decoration-fg-faint")}>{prazo.titulo}</span>
        {mostrarResponsavel ? <Avatar nome={prazo.responsavel.nome} usuarioId={prazo.responsavel.id} fotoEm={prazo.responsavel.fotoEm} className="size-4 text-[8px]" /> : null}
      </span>
      <FaixaChegada estado={estado} className="mt-1" />
    </button>
  );
}
