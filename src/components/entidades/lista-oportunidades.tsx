import Link from "next/link";
import type { TipoTerminal } from "@prisma/client";

export type OportunidadeVinculada = {
  id: string;
  titulo: string;
  pipeline: { chave: string; nome: string };
  fase: { nome: string; tipoTerminal: TipoTerminal | null };
  responsavel: { nome: string };
  /** O "outro lado" do vínculo (contato na empresa, empresa no contato). */
  extra?: string | null;
};

/** Oportunidades vinculadas (já sem soft-deletadas), com link para o card. */
export function ListaOportunidades({ itens }: { itens: OportunidadeVinculada[] }) {
  if (itens.length === 0) return <p className="text-sm text-fg-faint">Nenhuma oportunidade vinculada.</p>;
  return (
    <ul className="divide-y divide-border">
      {itens.map((o) => (
        <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
          <Link href={`/kanban/${o.id}`} className="min-w-0 truncate text-sm text-foreground hover:underline">
            {o.titulo}
          </Link>
          <span className="font-mono text-[11px] text-fg-mute">
            {o.pipeline.chave} · {o.fase.nome}
          </span>
          {o.fase.tipoTerminal ? (
            <span className={`rounded-full border px-1.5 font-mono text-[10px] leading-4 uppercase ${o.fase.tipoTerminal === "GANHO" ? "border-success/60" : "border-danger/60"} text-fg-soft`}>
              {o.fase.tipoTerminal === "GANHO" ? "ganho" : "perdido"}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-fg-mute">
            {o.extra ? `${o.extra} · ` : ""}
            {o.responsavel.nome}
          </span>
        </li>
      ))}
    </ul>
  );
}
