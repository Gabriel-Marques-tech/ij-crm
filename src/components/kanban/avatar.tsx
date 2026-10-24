import { cn } from "cn";

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
}

/** Avatar de iniciais (sem foto na v1). */
export function Avatar({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      title={nome}
      role="img"
      aria-label={`Responsável: ${nome}`}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-strong font-mono text-[10px] text-fg-soft",
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}
