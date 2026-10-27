import Link from "next/link";
import { sufixoVinculo } from "@/lib/entidades/sufixo-vinculo";
import type { Vinculo } from "@/lib/entidades/vinculo";

const ROTA = { empresa: "/empresas", contato: "/contatos" } as const;

/** Referência a Empresa/Contato: link só se viva; excluída é texto; mesclada aponta o destino. */
export function VinculoLink({ tipo, vinculo, className }: { tipo: "empresa" | "contato"; vinculo: Vinculo; className?: string }) {
  if (vinculo.estado === "ATIVO") {
    return (
      <Link href={`${ROTA[tipo]}/${vinculo.id}`} className={className ?? "text-foreground hover:underline"}>
        {vinculo.nome}
      </Link>
    );
  }
  return (
    <span className="text-fg-mute">
      <span className="line-through decoration-fg-faint">{vinculo.nome}</span> ({sufixoVinculo(tipo, vinculo.estado)}
      {vinculo.estado === "MESCLADO" && vinculo.destino ? (
        <>
          {" → "}
          <Link href={`${ROTA[tipo]}/${vinculo.destino.id}`} className="text-fg-soft hover:text-foreground hover:underline">
            {vinculo.destino.nome}
          </Link>
        </>
      ) : null}
      )
    </span>
  );
}
