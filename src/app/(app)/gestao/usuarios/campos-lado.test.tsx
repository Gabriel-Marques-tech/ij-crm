import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Cargo, Papel } from "@prisma/client";
import { CamposPapelLado } from "./campos-lado";

/**
 * Cargos por área no form de convite/edição (revisão do PR #75): o que a gestão vê e o
 * que o FormData manda. A regra em si é de `lib/auth/areas`; aqui é o estado da tela.
 */
const montar = (props: Partial<Parameters<typeof CamposPapelLado>[0]> = {}) =>
  render(
    <form data-testid="f">
      <CamposPapelLado papelAtor="GESTOR" papel="PROJETOS" area={null} cargos={[]} {...props} />
    </form>,
  );

const cargosMarcados = () => Array.from(screen.getByTestId("f").querySelectorAll<HTMLInputElement>('input[name="cargos"]:checked')).map((i) => i.value);
const rotulos = () => Array.from(screen.getByTestId("f").querySelectorAll<HTMLInputElement>('input[name="cargos"]')).map((i) => i.value);
const papel = () => (screen.getByLabelText("Papel") as HTMLSelectElement).value;
const areaHidden = () => (screen.getByTestId("f").querySelector('input[name="area"]') as HTMLInputElement).value;

describe("CamposPapelLado: cargos da área", () => {
  it("papel Projetos oferece PM, PO e Diretor (gestão pode promover); Vendedor só GP; visualizador nada", () => {
    // Monta de novo a cada papel: o estado inicial do componente vem das props só na montagem.
    const um = montar();
    expect(rotulos()).toEqual(["PM", "PO", "DIRETOR"]);
    um.unmount();
    const dois = montar({ papel: "VENDEDOR" });
    expect(rotulos()).toEqual(["GP"]);
    dois.unmount();
    montar({ papel: "VISUALIZADOR" });
    expect(rotulos()).toEqual([]);
    expect(screen.getByText("Sem área, sem cargo.")).toBeTruthy();
  });

  it("conta antiga com GP em Projetos aparece como PM e pode ser desmarcada (o form manda PM, não GP)", () => {
    montar({ cargos: ["GP"] as Cargo[] });
    expect(cargosMarcados()).toEqual(["PM"]);
    fireEvent.click(screen.getByLabelText("PM de projetos"));
    expect(cargosMarcados()).toEqual([]);
    fireEvent.click(screen.getByLabelText("PM de projetos"));
    expect(cargosMarcados()).toEqual(["PM"]);
  });

  it("cargo não viaja de lado: GP legado de Projetos que vira Vendedor não nasce GP de vendas", () => {
    montar({ cargos: ["GP"] as Cargo[] });
    fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "VENDEDOR" } });
    expect(rotulos()).toEqual(["GP"]);
    expect(cargosMarcados()).toEqual([]);
  });

  it("gestor com lado: trocar a área zera os cargos (GP de vendas não vira PM de projetos)", () => {
    montar({ papel: "GESTOR", area: "VENDAS", cargos: ["GP"] as Cargo[] });
    expect(cargosMarcados()).toEqual(["GP"]);
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "PROJETOS" } });
    expect(rotulos()).toEqual(["PM", "PO", "DIRETOR"]);
    expect(cargosMarcados()).toEqual([]);
  });

  it("marcar Diretor com papel Projetos troca o papel para Gestor e mantém o lado Projetos", () => {
    montar();
    expect(screen.getByText(/Diretor = gestão com lado Projetos/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Diretor de projetos"));
    expect(papel()).toBe("GESTOR");
    expect(areaHidden()).toBe("PROJETOS");
    expect(cargosMarcados()).toEqual(["DIRETOR"]);
    // Voltando a Projetos, o Diretor sai (é da gestão).
    fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "PROJETOS" } });
    expect(cargosMarcados()).toEqual([]);
  });

  it("gestor/admin já com lado Projetos vê Diretor sem a dica de troca de papel", () => {
    montar({ papel: "GESTOR" as Papel, area: "PROJETOS", cargos: ["PM"] as Cargo[] });
    expect(rotulos()).toEqual(["PM", "PO", "DIRETOR"]);
    expect(screen.queryByText(/marcar troca o papel/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Diretor de projetos"));
    expect(cargosMarcados()).toEqual(["PM", "DIRETOR"]);
    expect(papel()).toBe("GESTOR");
  });

  it("admin editando a si mesmo (sem papel) escolhe lado e cargo", () => {
    montar({ papelAtor: "ADMIN", papel: "ADMIN", area: null, cargos: [], mostrarPapel: false });
    expect(screen.queryByLabelText("Papel")).toBeNull();
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "VENDAS" } });
    expect(rotulos()).toEqual(["GP"]);
    fireEvent.click(screen.getByLabelText("GP de vendas"));
    expect(cargosMarcados()).toEqual(["GP"]);
  });
});
