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

  // Segunda 27/10/2025 (12:00Z). "Semana que vem" = semana de segunda 03/11.
  const SEGUNDA = new Date("2025-10-27T12:00:00Z");

  it.each([
    ["segunda da semana que vem", "2025-11-03"],
    ["terça da semana que vem", "2025-11-04"],
    ["quarta da semana que vem", "2025-11-05"],
    ["quinta da semana que vem", "2025-11-06"],
    ["sexta da semana que vem", "2025-11-07"],
    ["sábado da semana que vem", "2025-11-08"],
    ["domingo da semana que vem", "2025-11-09"],
    ["terça da próxima semana", "2025-11-04"],
    ["na sexta-feira da próxima semana", "2025-11-07"],
    ["semana que vem na quarta", "2025-11-05"],
    // Sozinhos, sem mudança.
    ["sexta", "2025-10-31"],
    ["semana que vem", "2025-11-03"],
    ["próxima semana", "2025-11-03"],
    ["sexta que vem", "2025-10-31"],
    // "ter" (verbo) não é terça.
    ["vou ter reunião semana que vem", "2025-11-03"],
  ])("a partir de uma segunda: %j → %s", (expr, esperado) => {
    expect(resolverDataRelativa(expr, SEGUNDA)).toBe(esperado);
  });

  it("dia da semana + semana que vem dito numa sexta", () => {
    expect(resolverDataRelativa("terça da semana que vem", SEXTA)).toBe("2025-10-28");
    expect(resolverDataRelativa("sexta da semana que vem", SEXTA)).toBe("2025-10-31");
  });

  it.each([
    ["dia 3 de novembro", "2025-11-03"],
    ["3 de novembro", "2025-11-03"],
    ["3 de nov", "2025-11-03"],
    ["dia 25 de outubro", "2025-10-25"],
    ["03/11", "2025-11-03"],
    ["3/11", "2025-11-03"],
    ["dia 15 de dezembro", "2025-12-15"],
    // Regra única para dia/mês sem ano: já passou neste ano → ano que vem
    // (é a data de uma PRÓXIMA ação).
    ["dia 10 de janeiro", "2026-01-10"],
    ["dia 20 de outubro", "2026-10-20"],
    ["20/10", "2026-10-20"],
    ["dia 3 de março", "2026-03-03"],
    // "de manhã/tarde/noite" não é mês.
    ["dia 30 de manhã", "2025-10-30"],
  ])("mês por nome ou número: %j → %s", (expr, esperado) => {
    expect(resolverDataRelativa(expr, SEXTA)).toBe(esperado);
  });

  it.each(["dia 3 de novembrx", "3 de brumário", "dia 31 de novembro"])("mês textual não reconhecido ou dia inválido: %j → null", (expr) => {
    expect(resolverDataRelativa(expr, SEXTA)).toBeNull();
  });
});
