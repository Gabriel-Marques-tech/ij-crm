import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Mascote } from "@/components/marca/marca";
import type { NomeMascote } from "@/components/marca/assets";

const ALTURA = { sm: 96, md: 128, lg: 160 } as const;

/**
 * Estado vazio com o mascote da IJ (decorativo, `alt=""`): título curto,
 * texto opcional e uma ação opcional (ex.: limpar filtros).
 */
export function EstadoVazio({
  mascote,
  titulo,
  texto,
  acao,
  tamanho = "md",
  className,
}: {
  mascote: NomeMascote;
  titulo: string;
  texto?: ReactNode;
  acao?: ReactNode;
  tamanho?: keyof typeof ALTURA;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-6 text-center", className)}>
      <Mascote nome={mascote} altura={ALTURA[tamanho]} />
      <p className="mt-3 text-sm font-medium text-foreground">{titulo}</p>
      {texto ? <p className="mt-1 max-w-sm text-sm text-fg-mute">{texto}</p> : null}
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}
