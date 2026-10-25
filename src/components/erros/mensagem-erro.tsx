import { cn } from "cn";
import type { FalhaUI } from "@/lib/erros/cliente";

/** Falha inline; a ref (quando há) vai em mono e selecionável para o usuário copiar. */
export function MensagemErro({ falha, className }: { falha: FalhaUI | null; className?: string }) {
  if (!falha) return null;
  return (
    <p role="alert" className={cn("text-xs text-danger", className)}>
      {falha.texto}
      {falha.ref ? (
        <>
          {" "}
          <span className="text-fg-soft">
            (ref: <code className="font-mono select-all">{falha.ref}</code>)
          </span>
        </>
      ) : null}
    </p>
  );
}
