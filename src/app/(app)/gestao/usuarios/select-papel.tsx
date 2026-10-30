"use client";

import type { Papel } from "@prisma/client";
import { podeAtribuirPapel } from "@/lib/auth/papeis";

const OPCOES: { valor: Papel; rotulo: string }[] = [
  { valor: "VISUALIZADOR", rotulo: "Visualizador (somente leitura)" },
  { valor: "VENDEDOR", rotulo: "Vendedor" },
  { valor: "PROJETOS", rotulo: "Projetos" },
  { valor: "GESTOR", rotulo: "Gestor" },
  { valor: "ADMIN", rotulo: "Admin" },
];

/** Select nativo (funciona dentro de <form action>); só mostra papéis que o ator pode atribuir. */
export function SelectPapel({
  name,
  papelAtor,
  defaultValue,
  id,
  onChange,
}: {
  name: string;
  papelAtor: Papel;
  defaultValue: Papel;
  id?: string;
  onChange?: (papel: Papel) => void;
}) {
  return (
    <select
      id={id ?? name}
      name={name}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.currentTarget.value as Papel) : undefined}
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
