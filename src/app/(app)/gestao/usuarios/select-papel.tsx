"use client";

import type { Papel } from "@prisma/client";
import { podeAtribuirPapel } from "@/lib/auth/papeis";

const OPCOES: { valor: Papel; rotulo: string }[] = [
  { valor: "VENDEDOR", rotulo: "Vendedor" },
  { valor: "GESTOR", rotulo: "Gestor" },
  { valor: "ADMIN", rotulo: "Admin" },
];

/** Select nativo (funciona dentro de <form action>); só mostra papéis que o ator pode atribuir. */
export function SelectPapel({
  name,
  papelAtor,
  defaultValue,
  id,
}: {
  name: string;
  papelAtor: Papel;
  defaultValue: Papel;
  id?: string;
}) {
  return (
    <select
      id={id ?? name}
      name={name}
      defaultValue={defaultValue}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {OPCOES.filter((o) => podeAtribuirPapel(papelAtor, o.valor)).map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );
}
