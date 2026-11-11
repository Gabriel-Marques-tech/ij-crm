"use client";

import { cn } from "cn";
import { useComentarios } from "./comentarios-contexto";

/** Linha do "Para enviar ao cliente": cor funcional só no ponto. */
export function Marcador({ ok, texto, valor }: { ok: boolean; texto: string; valor?: string }) {
  return (
    <p className="flex items-center gap-2 py-0.5 text-[13px] text-fg-soft">
      <i aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-warn")} />
      <span className="min-w-0 flex-1">{texto}</span>
      {valor ? <span className="font-mono text-xs text-fg-mute tabular">{valor}</span> : null}
    </p>
  );
}

/** Ao vivo, pelo polling dos comentários. */
export function ComentariosAbertos() {
  const c = useComentarios();
  const abertos = c?.threads.filter((t) => !t.resolvido && !t.pendente).length ?? 0;
  return <Marcador ok={abertos === 0} texto="Comentários abertos" valor={String(abertos)} />;
}
