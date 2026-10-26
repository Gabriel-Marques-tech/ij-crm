"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Gestor/admin: troca de quem é a semana (`?vendedor=`). O servidor revalida a permissão. */
export function SeletorVendedor({ atualId, proprioId, opcoes }: { atualId: string; proprioId: string; opcoes: { id: string; nome: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-fg-mute">
      <span className="eyebrow">semana de</span>
      <select
        value={atualId}
        disabled={pendente}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(() => router.push(v === proprioId ? pathname : `${pathname}?vendedor=${encodeURIComponent(v)}`));
        }}
        className="h-8 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === proprioId ? `${o.nome} (você)` : o.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
