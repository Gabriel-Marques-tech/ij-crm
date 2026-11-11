"use client";

import { useState } from "react";
import type { Area, AreaEntrada, Cargo, Papel } from "@prisma/client";
import { Label } from "@/components/ui/label";
import {
  AREAS,
  AREAS_ENTRADA,
  cargosDaArea,
  ROTULO_AREA,
  ROTULO_AREA_ENTRADA,
  ROTULO_CARGO,
  regraDeArea,
  resolverAreaCargos,
  usaAreaDeEntrada,
} from "@/lib/auth/areas";
import { podeAtribuirPapel, temPapelMinimo } from "@/lib/auth/papeis";
import { SelectPapel } from "./select-papel";

const CLASSE_SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

/**
 * Papel + área + cargos (GAB-82) + área de entrada (GAB-97), no convite e na edição. A área acompanha o
 * papel (vendedor → vendas, projetos → projetos, visualizador → nenhuma); só
 * gestor/admin escolhem, e só explicitamente: começam em "Nenhuma" e, ao
 * trocar para gestor/admin vindo de papel com área fixa, a área e os cargos zeram.
 * Os cargos oferecidos são os da área (`cargosDaArea`): GP em Vendas; PM, PO e Diretor em
 * Projetos. Diretor é a gestão com lado Projetos: marcá-lo com papel Projetos troca o papel
 * para Gestor (só aparece para quem pode atribuir Gestor). Conta antiga com GP em Projetos
 * aparece com PM marcado (sinônimo) e grava PM ao salvar.
 * O servidor reaplica a mesma regra (lib/auth/areas, usuarios.ts).
 * A área de entrada só aparece para quem a usa: admin, gestor sem área e visualizador.
 * `mostrarPapel=false`: admin editando a si mesmo — só lado/cargo, sem papel.
 */
export function CamposPapelLado({
  papelAtor,
  papel: papelInicial,
  area: areaInicial,
  cargos: cargosIniciais,
  areaEntrada: areaEntradaInicial = null,
  mostrarPapel = true,
}: {
  papelAtor: Papel;
  papel: Papel;
  area: Area | null;
  cargos: readonly Cargo[];
  areaEntrada?: AreaEntrada | null;
  mostrarPapel?: boolean;
}) {
  const [papel, setPapel] = useState<Papel>(papelInicial);
  const [areaLivre, setAreaLivre] = useState<Area | null>(areaInicial);
  // Estado já normalizado pela régua do servidor: conta antiga com GP em Projetos entra como PM (e pode ser
  // desmarcada), e cargo que não vale para o lado atual não fica escondido para reaparecer em outro lado.
  const [cargos, setCargos] = useState<Cargo[]>(() => resolverAreaCargos(papelInicial, areaInicial, cargosIniciais).cargos);
  // Sem valor no banco vale Geral: o select mostra o que de fato acontece.
  const [areaEntrada, setAreaEntrada] = useState<AreaEntrada>(areaEntradaInicial ?? "GERAL");

  const regra = regraDeArea(papel);
  const efetivo = resolverAreaCargos(papel, areaLivre, cargos);
  const areaEfetiva = efetivo.area;
  // Diretor aparece para a gestão e, com papel Projetos, para quem pode promover a Gestor (marcar troca o papel).
  const podeVirarDiretor = mostrarPapel && papel === "PROJETOS" && podeAtribuirPapel(papelAtor, "GESTOR");
  const opcoes = areaEfetiva ? cargosDaArea(areaEfetiva, podeVirarDiretor ? "GESTOR" : papel) : [];

  function trocarPapel(novo: Papel) {
    // Lado de gestor/admin só por escolha explícita: não herda a área fixa do papel anterior.
    const viraLivre = regraDeArea(novo).tipo === "livre" && regraDeArea(papel).tipo !== "livre";
    if (viraLivre) setAreaLivre(null);
    // Cargo não viaja de lado: se o lado efetivo muda com o papel, os cargos zeram.
    if (viraLivre || resolverAreaCargos(novo, areaLivre, []).area !== areaEfetiva) setCargos([]);
    // Diretor é da gestão: ao deixar de ser gestor/admin, o cargo sai (senão voltaria marcado ao reescolher Gestor).
    else if (!temPapelMinimo(novo, "GESTOR")) setCargos((atual) => atual.filter((c) => c !== "DIRETOR"));
    setPapel(novo);
  }

  function trocarArea(nova: Area | null) {
    setAreaLivre(nova);
    // Gestor/admin mudando de lado: GP de vendas não vira PM de projetos (nem o contrário) sem a gestão marcar.
    setCargos([]);
  }

  function marcarCargo(c: Cargo, marcado: boolean) {
    // Parte do que está visível (efetivo), não do estado cru: nada escondido sobrevive ao clique.
    setCargos(marcado ? [...efetivo.cargos, c] : efetivo.cargos.filter((x) => x !== c));
    // Diretor = gestão com lado Projetos: marcar com papel Projetos promove a Gestor, mantendo o lado.
    if (c === "DIRETOR" && marcado && papel === "PROJETOS") {
      setAreaLivre("PROJETOS");
      setPapel("GESTOR");
    }
  }

  return (
    <>
      {mostrarPapel ? (
        <div className="space-y-1.5">
          <Label htmlFor="papel">Papel</Label>
          <SelectPapel name="papel" papelAtor={papelAtor} value={papel} onChange={trocarPapel} />
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
            onChange={(e) => trocarArea((e.currentTarget.value || null) as Area | null)}
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
          {areaEfetiva ? (
            opcoes.map((c) => (
              <label key={c} className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="cargos" value={c} checked={efetivo.cargos.includes(c)} onChange={(e) => marcarCargo(c, e.currentTarget.checked)} />
                {ROTULO_CARGO[c]} de {ROTULO_AREA[areaEfetiva].toLowerCase()}
              </label>
            ))
          ) : (
            <p className="flex h-9 items-center text-sm text-fg-faint">Sem área, sem cargo.</p>
          )}
        </fieldset>
      </div>
      <p className="text-xs text-fg-faint">
        {regra.tipo === "fixa"
          ? "A área vem do papel."
          : regra.tipo === "nenhuma"
            ? "Visualizador não tem área nem cargo."
            : "Gestão/admin: área só se a pessoa também responde por um lado."}{" "}
        GP (vendas) e PM (projetos) agem em nome do seu lado na proposta; PO é só o cargo.
        {podeVirarDiretor ? " Diretor = gestão com lado Projetos: marcar troca o papel para Gestor." : ""}
      </p>
      {usaAreaDeEntrada(papel, efetivo.area) ? (
        <div className="space-y-1.5">
          <Label htmlFor="areaEntrada">Área de entrada</Label>
          <select
            id="areaEntrada"
            name="areaEntrada"
            value={areaEntrada}
            onChange={(e) => setAreaEntrada(e.currentTarget.value as AreaEntrada)}
            className={CLASSE_SELECT}
          >
            {AREAS_ENTRADA.map((a) => (
              <option key={a} value={a}>
                {ROTULO_AREA_ENTRADA[a]}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg-faint">Onde a pessoa cai ao abrir o CRM.</p>
        </div>
      ) : null}
    </>
  );
}
