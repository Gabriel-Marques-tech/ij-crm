import { describe, expect, it } from "vitest";
import { resolverDataRelativa } from "./datas";

// 24/10/2025 é sexta-feira. 12:00Z = 09:00 em São Paulo.
const SEXTA = new Date("2025-10-24T12:00:00Z");
// 23:30 de segunda 27/10 em SP = 02:30Z de terça 28/10: o dia civil é o de SP.
const SEGUNDA_NOITE_SP = new Date("2025-10-28T02:30:00Z");

describe("resolverDataRelativa (America/Sao_Paulo)", () => {
  it.each([
    ["hoje", "2025-10-24"],
    ["amanhã", "2025-10-25"],
    ["amanha", "2025-10-25"],
    ["depois de amanhã", "2025-10-26"],
    // Dia da semana = próxima ocorrência ESTRITAMENTE depois de hoje.
    ["sexta", "2025-10-31"],
    ["sexta-feira", "2025-10-31"],
    ["sexta que vem", "2025-10-31"],
    ["próxima sexta", "2025-10-31"],
    ["segunda", "2025-10-27"],
    ["terça", "2025-10-28"],
    ["quarta-feira", "2025-10-29"],
    ["qui", "2025-10-30"],
    ["sábado", "2025-10-25"],
    ["domingo", "2025-10-26"],
    ["semana que vem", "2025-10-27"],
    ["próxima semana", "2025-10-27"],
    ["daqui a 3 dias", "2025-10-27"],
    ["em 10 dias", "2025-11-03"],
    ["daqui 2 semanas", "2025-11-07"],
    ["fim do mês", "2025-10-31"],
    ["mês que vem", "2025-11-01"],
    ["31/10", "2025-10-31"],
    ["5/11", "2025-11-05"],
    // Dia/mês que já passou no ano → ano seguinte.
    ["10/01", "2026-01-10"],
    ["03/11/2025", "2025-11-03"],
    ["3/11/25", "2025-11-03"],
    ["2025-12-01", "2025-12-01"],
    ["dia 30", "2025-10-30"],
    ["dia 5", "2025-11-05"],
  ])("%j → %s", (expr, esperado) => {
    expect(resolverDataRelativa(expr, SEXTA)).toBe(esperado);
  });

  it("referência é o dia civil em São Paulo, não em UTC", () => {
    expect(resolverDataRelativa("amanhã", SEGUNDA_NOITE_SP)).toBe("2025-10-28");
    expect(resolverDataRelativa("hoje", SEGUNDA_NOITE_SP)).toBe("2025-10-27");
  });

  it.each(["", "   ", "logo", "quando der", "31/02", "32/10", "2025-13-01", "dia 40", "daqui a 900 dias"])("%j → null", (expr) => {
    expect(resolverDataRelativa(expr, SEXTA)).toBeNull();
  });

  it("aceita expressão dentro de frase curta", () => {
    expect(resolverDataRelativa("até sexta", SEXTA)).toBe("2025-10-31");
    expect(resolverDataRelativa("na segunda-feira", SEXTA)).toBe("2025-10-27");
  });
});
