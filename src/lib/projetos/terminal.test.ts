import { describe, expect, it } from "vitest";
import { pipelinesExtrasDoTerminal } from "./terminal";

describe("pipelinesExtrasDoTerminal", () => {
  it("ganho em vendas também envolve projetos; o resto, só o próprio quadro", () => {
    expect(pipelinesExtrasDoTerminal("vendas", "GANHO")).toEqual(["projetos"]);
    expect(pipelinesExtrasDoTerminal("vendas", "PERDIDO")).toEqual([]);
    expect(pipelinesExtrasDoTerminal("vendas", null)).toEqual([]);
    expect(pipelinesExtrasDoTerminal("projetos", "GANHO")).toEqual([]);
  });
});
