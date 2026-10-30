"use client";

import { useState } from "react";
import type { Area, Cargo, Papel } from "@prisma/client";
import { Label } from "@/components/ui/label";
import { AREAS, CARGOS, ROTULO_AREA, ROTULO_CARGO, regraDeArea, resolverAreaCargos } from "@/lib/auth/areas";
import { SelectPapel } from "./select-papel";

const CLASSE_SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

/**
 * Papel + área + cargos (GAB-82), no convite e na edição. A área acompanha o
 * papel (vendedor → vendas, projetos → projetos, visualizador → nenhuma); só
 * gestor/admin escolhem, e só explicitamente: começam em "Nenhuma" e, ao
 * trocar para gestor/admin vindo de papel com área fixa, a área e o GP zeram.
 * O servidor reaplica a mesma regra (lib/auth/areas, usuarios.ts).
 * `mostrarPapel=false`: admin editando a si mesmo — só lado/cargo, sem papel.
 */
export function CamposPapelLado({
  papelAtor,
  papel: papelInicial,
  area: areaInicial,
  cargos: cargosIniciais,
  mostrarPapel = true,
}: {
  papelAtor: Papel;
  papel: Papel;
  area: Area | null;
  cargos: readonly Cargo[];
  mostrarPapel?: boolean;
}) {
  const [papel, setPapel] = useState<Papel>(papelInicial);
  const [areaLivre, setAreaLivre] = useState<Area | null>(areaInicial);
  const [cargos, setCargos] = useState<Cargo[]>([...cargosIniciais]);

  const regra = regraDeArea(papel);
  const efetivo = resolverAreaCargos(papel, areaLivre, cargos);

  function trocarPapel(novo: Papel) {
    // Lado de gestor/admin só por escolha explícita: não herda a área fixa do papel anterior.
    if (regraDeArea(novo).tipo === "livre" && regraDeArea(papel).tipo !== "livre") {
      setAreaLivre(null);
      setCargos([]);
    }
    setPapel(novo);
  }

  return (
    <>
      {mostrarPapel ? (
        <div className="space-y-1.5">
          <Label htmlFor="papel">Papel</Label>
          <SelectPapel name="papel" papelAtor={papelAtor} defaultValue={papelInicial} onChange={trocarPapel} />
        </div>
      ) : null}
      <input type="hidden" name="ladoNoForm" value="1" />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="area">Área</Label>
          {/* Select desabilitado não vai no FormData: o valor efetivo segue no hidden. */}
          <select
            id="area"
            value={efetivo.area ?? ""}
            disabled={regra.tipo !== "livre"}
            onChange={(e) => setAreaLivre((e.currentTarget.value || null) as Area | null)}
            className={CLASSE_SELECT}
          >
            <option value="">Nenhuma</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {ROTULO_AREA[a]}
              </option>
            ))}
          </select>
          <input type="hidden" name="area" value={efetivo.area ?? ""} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Cargo na área</legend>
          {CARGOS.map((c) => (
            <label key={c} className={`flex h-9 items-center gap-2 text-sm ${efetivo.area ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                name="cargos"
                value={c}
                disabled={!efetivo.area}
                checked={efetivo.cargos.includes(c)}
                onChange={(e) => {
                  const marcado = e.currentTarget.checked;
                  setCargos((atual) => (marcado ? [...atual, c] : atual.filter((x) => x !== c)));
                }}
              />
              {ROTULO_CARGO[c]}
              {efetivo.area ? ` de ${ROTULO_AREA[efetivo.area].toLowerCase()}` : ""}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="text-xs text-fg-faint">
        {regra.tipo === "fixa"
          ? "A área vem do papel."
          : regra.tipo === "nenhuma"
            ? "Visualizador não tem área nem cargo."
            : "Gestão/admin: área só se a pessoa também responde por um lado."}{" "}
        GP age em nome do seu lado na proposta.
      </p>
    </>
  );
}
