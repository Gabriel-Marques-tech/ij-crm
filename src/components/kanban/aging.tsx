import { cn } from "cn";
import type { NivelAging } from "@/lib/projetos/aging";

/** Semântica de aging só em dot + borda esquerda, nunca fundo (§4.5.1). */
export const DOT_AGING: Record<NivelAging, string> = {
  neutro: "bg-fg-faint",
  verde: "bg-success",
  ambar: "bg-warn",
  vermelho: "bg-danger",
};

export const BORDA_AGING: Record<NivelAging, string> = {
  neutro: "border-l-border-strong",
  verde: "border-l-success",
  ambar: "border-l-warn",
  vermelho: "border-l-danger",
};

const ROTULO: Record<NivelAging, string> = {
  neutro: "sem limite de alerta",
  verde: "dentro do prazo",
  ambar: "perto do limite",
  vermelho: "acima do limite",
};

export function DiasNaFase({ dias, nivel, className }: { dias: number; nivel: NivelAging; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-mute tabular", className)}
      title={`${dias} dia(s) na fase — ${ROTULO[nivel]}`}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_AGING[nivel])} />
      {dias}d<span className="sr-only"> na fase, {ROTULO[nivel]}</span>
    </span>
  );
}
