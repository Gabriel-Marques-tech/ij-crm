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

/**
 * Select nativo (funciona dentro de <form action>); só mostra papéis que o ator pode atribuir.
 * Com `value` é controlado (o pai pode trocar o papel por fora, ex.: marcar Diretor); sem, começa em `defaultValue`.
 */
export function SelectPapel({
  name,
  papelAtor,
  defaultValue,
  value,
  id,
  onChange,
}: {
  name: string;
  papelAtor: Papel;
  defaultValue?: Papel;
  value?: Papel;
  id?: string;
  onChange?: (papel: Papel) => void;
}) {
  return (
    <select
      id={id ?? name}
      name={name}
      defaultValue={value === undefined ? defaultValue : undefined}
      value={value}
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
