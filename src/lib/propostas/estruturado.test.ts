import { describe, expect, it } from "vitest";
import { datasPrevistas, diaValido, duracaoEmDias, ENTREGAS_MAX, estruturadoParaEntrada, formularioGravavel, interpretarEstruturado, lerEstruturadoGravado, mesmoEstruturado, normalizarDuracao, somaDasParcelas, valorParaCampo } from "./estruturado";

describe("interpretarEstruturado (validação no servidor)", () => {
  it("vazio é válido: tudo nulo, sem entregas", () => {
    expect(interpretarEstruturado({})).toEqual({ ok: true, valor: { valor: null, prazoDias: null, escopoResumo: null, entregas: [] } });
    expect(interpretarEstruturado(undefined)).toMatchObject({ ok: true });
  });

  it("valor em reais (BR), ≥ 0; prazo em dias inteiros 1–3650", () => {
    expect(interpretarEstruturado({ valor: "R$ 12.500,5", prazoDias: 60 })).toMatchObject({ ok: true, valor: { valor: "12500.50", prazoDias: 60 } });
    expect(interpretarEstruturado({ valor: "0" })).toMatchObject({ ok: true, valor: { valor: "0.00" } });
    for (const valor of ["-1", "abc", "1,234", "12.50"]) expect(interpretarEstruturado({ valor }).ok, valor).toBe(false);
    for (const prazoDias of ["0", "1.5", "-3", "3651", "dez"]) expect(interpretarEstruturado({ prazoDias }).ok, prazoDias).toBe(false);
  });

  it("cronograma: ordem do usuário preservada; nome, data real e valor validados com o número da entrega", () => {
    const r = interpretarEstruturado({ entregas: [{ titulo: " Fase  2 ", dia: "2027-01-10" }, { titulo: "Fase 1", dia: "2026-12-01", valor: "1.000,00" }] });
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ entregas: [{ titulo: "Fase 2", dia: "2027-01-10", duracao: null, valor: null }, { titulo: "Fase 1", dia: "2026-12-01", duracao: null, valor: "1000.00" }] }) });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01" }, { titulo: "", dia: "2026-01-01" }] })).toEqual({ ok: false, erro: "Entrega 2: dê um nome (até 200 caracteres)." });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-13-01" }] })).toEqual({ ok: false, erro: "Entrega 1: data inválida (use AAAA-MM-DD)." });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", valor: "-5" }] }).ok).toBe(false);
    expect(interpretarEstruturado({ entregas: Array.from({ length: 51 }, () => ({ titulo: "a", dia: "2026-01-01" })) }).ok).toBe(false);
  });

  it("campos desconhecidos e tipos errados são recusados", () => {
    expect(interpretarEstruturado({ valor: 10 }).ok).toBe(false);
    expect(interpretarEstruturado({ outro: "x" }).ok).toBe(false);
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", extra: 1 }] }).ok).toBe(false);
  });

  it("escopo resumido até 2000 caracteres", () => {
    expect(interpretarEstruturado({ escopoResumo: "x".repeat(2001) }).ok).toBe(false);
    expect(interpretarEstruturado({ escopoResumo: "  " })).toMatchObject({ ok: true, valor: { escopoResumo: null } });
  });
});

describe("apoio", () => {
  it("diaValido rejeita dia que não existe", () => {
    expect(diaValido("2028-02-29")).toBe(true);
    expect(diaValido("2027-02-29")).toBe(false);
    expect(diaValido("01/02/2027")).toBe(false);
  });

  it("gravado → formulário → gravado é o mesmo", () => {
    const e = { valor: "12500.00", prazoDias: 30, escopoResumo: "Site", entregas: [{ titulo: "A", dia: "2026-12-01", duracao: null, valor: "1500.50" }] };
    expect(valorParaCampo("1234567.80")).toBe("1.234.567,80");
    expect(interpretarEstruturado(estruturadoParaEntrada(e))).toEqual({ ok: true, valor: e });
    expect(lerEstruturadoGravado(e)).toEqual(e);
    expect(lerEstruturadoGravado("lixo")).toEqual({ valor: null, prazoDias: null, escopoResumo: null, entregas: [] });
  });

  it("soma das parcelas em centavos (sem erro de ponto flutuante)", () => {
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", duracao: null, valor: "0.10" }, { titulo: "b", dia: "2026-01-02", duracao: null, valor: "0.20" }])).toBe("0.30");
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", duracao: null, valor: null }])).toBeNull();
  });
});

describe("duração na entrega (GAB-100)", () => {
  it("entrega com data ou duração; a duração é normalizada", () => {
    const r = interpretarEstruturado({ entregas: [{ titulo: "A", duracao: "2 Sem" }, { titulo: "B", duracao: "1 semanas", valor: "1,00" }, { titulo: "C", dia: "2026-12-01" }, { titulo: "D", duracao: " 3 meses " }, { titulo: "E", duracao: "1 mês" }, { titulo: "F", duracao: "15 dias" }] });
    expect(r).toMatchObject({
      ok: true,
      valor: {
        entregas: [
          { titulo: "A", dia: null, duracao: "2 semanas", valor: null },
          { titulo: "B", dia: null, duracao: "1 semana", valor: "1.00" },
          { titulo: "C", dia: "2026-12-01", duracao: null, valor: null },
          { titulo: "D", dia: null, duracao: "3 meses", valor: null },
          { titulo: "E", dia: null, duracao: "1 mês", valor: null },
          { titulo: "F", dia: null, duracao: "15 dias", valor: null },
        ],
      },
    });
  });

  it("nem data nem duração, as duas, ou duração que não se entende são recusadas com o número da entrega", () => {
    expect(interpretarEstruturado({ entregas: [{ titulo: "a" }] })).toEqual({ ok: false, erro: 'Entrega 1: informe a data ou a duração (como "2 semanas").' });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", duracao: "2 semanas" }] })).toEqual({ ok: false, erro: "Entrega 1: informe a data ou a duração, não as duas." });
    for (const duracao of ["logo", "0 dias", "2", "semanas", "dois meses", "3651 dias", "522 semanas", "122 meses"]) expect(interpretarEstruturado({ entregas: [{ titulo: "a", duracao }] }).ok, duracao).toBe(false);
  });

  it("o teto da duração é o do prazo, inclusive na soma: a data prevista continua dentro do que a execução aceita", () => {
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", duracao: "3650 dias" }] }).ok).toBe(true);
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", duracao: "3000 dias" }, { titulo: "b", duracao: "651 dias" }] })).toEqual({ ok: false, erro: "As durações somam mais de 3650 dias." });
  });

  describe("formularioGravavel", () => {
    const l = (titulo: string, o: object = {}) => ({ titulo, dia: "2027-01-10", duracao: "", valor: "", ...o });
    const salvo = { valor: "1.000,00", prazoDias: "30", escopoResumo: "x", entregas: [l("A"), l("B"), l("C")] };

    it("cada campo válido vai; o inválido fica como estava; linha nova incompleta fica de fora", () => {
      const r = formularioGravavel({ ...salvo, valor: "2.000,00", prazoDias: "abc", entregas: [...salvo.entregas, l("D", { chaveNova: "n1" }), l("", { dia: "", chaveNova: "n2" })] }, salvo);
      expect(r.form).toEqual({ ...salvo, valor: "2.000,00", entregas: [...salvo.entregas, l("D")] });
      expect(r.chaves).toEqual(["n1"]);
    });

    it("B incompleta + D nova: cronograma salvo inteiro e mais a D (nunca só A, C, D)", () => {
      const r = formularioGravavel({ ...salvo, escopoResumo: "y", entregas: [l("A"), l("B", { dia: "" }), l("C"), l("D", { chaveNova: "n1" })] }, salvo);
      expect(r.form).toEqual({ ...salvo, escopoResumo: "y", entregas: [...salvo.entregas, l("D")] });
      expect(r.chaves).toEqual(["n1"]);
    });

    it("A e C incompletas com D e E novas: as gravadas ficam como estavam, e as novas válidas entram", () => {
      const r = formularioGravavel({ ...salvo, entregas: [l("A", { dia: "" }), l("B", { titulo: "B editada" }), l("C", { titulo: "" }), l("D", { chaveNova: "n1" }), l("E", { chaveNova: "n2" }), l("", { dia: "", chaveNova: "n3" })] }, salvo);
      expect(r.form.entregas).toEqual([...salvo.entregas, l("D"), l("E")]);
      expect(r.chaves).toEqual(["n1", "n2"]);
    });

    it("gravada incompleta sem linha nova válida: o salvo fica igual, sem gravação à toa", () => {
      const r = formularioGravavel({ ...salvo, entregas: [l("A", { dia: "" }), l("B"), l("C")] }, salvo);
      expect(r.form).toEqual(salvo);
      expect(r.chaves).toEqual([]);
    });

    it("nova válida que não cabe no limite do cronograma não apaga nada: fica o salvo", () => {
      const cheio = { ...salvo, entregas: Array.from({ length: ENTREGAS_MAX }, (_, i) => l(`E${i}`)) };
      const r = formularioGravavel({ ...cheio, entregas: [l("E0", { dia: "" }), ...cheio.entregas.slice(1), l("D", { chaveNova: "n1" })] }, cheio);
      expect(r.form.entregas).toEqual(cheio.entregas);
      expect(r.chaves).toEqual([]);
    });

    it("gravada removida de propósito continua removida; payload sem marca de edição", () => {
      const r = formularioGravavel({ ...salvo, entregas: [l("A"), l("C"), l("", { dia: "", chaveNova: "n1" })] }, salvo);
      expect(r.form.entregas).toEqual([l("A"), l("C")]);
      expect(JSON.stringify(r.form)).not.toContain("chaveNova");
    });
  });

  it("entrega antiga, gravada só com dia, continua válida e igual depois de relida", () => {
    const antiga = { valor: null, prazoDias: null, escopoResumo: null, entregas: [{ titulo: "A", dia: "2026-12-01", valor: null }] };
    const lida = lerEstruturadoGravado(antiga);
    expect(lida.entregas).toEqual([{ titulo: "A", dia: "2026-12-01", duracao: null, valor: null }]);
    // Reenviar o formulário de uma proposta antiga não conta como mudança (regra de §4.4, "concordar").
    const reenviada = interpretarEstruturado(estruturadoParaEntrada(lida));
    expect(reenviada.ok && mesmoEstruturado(reenviada.valor, lida)).toBe(true);
  });

  it("entrega só com duração não some ao reler; só linha sem nada é descartada", () => {
    const lida = lerEstruturadoGravado({ entregas: [{ titulo: "A", dia: null, duracao: "2 semanas", valor: null }, { titulo: "B" }, { titulo: "C", dia: "" }] });
    expect(lida.entregas).toEqual([{ titulo: "A", dia: null, duracao: "2 semanas", valor: null }]);
    const r = interpretarEstruturado(estruturadoParaEntrada(lida));
    expect(r.ok && mesmoEstruturado(r.valor, lida)).toBe(true);
  });

  it("datasPrevistas: durações em sequência a partir do início; data fixa vira o novo ponto de partida; nenhuma some", () => {
    const entregas = [
      { titulo: "A", dia: null, duracao: "2 semanas", valor: "10.00" },
      { titulo: "B", dia: null, duracao: "1 mês", valor: null },
      { titulo: "C", dia: "2027-06-01", duracao: null, valor: null },
      { titulo: "D", dia: null, duracao: "3 dias", valor: null },
    ];
    expect(datasPrevistas(entregas, "2026-12-20")).toEqual([
      { titulo: "A", dia: "2027-01-03", valor: "10.00" },
      { titulo: "B", dia: "2027-02-02", valor: null },
      { titulo: "C", dia: "2027-06-01", valor: null },
      { titulo: "D", dia: "2027-06-04", valor: null },
    ]);
    // Linha estranha gravada não derruba nem desloca a conta das outras.
    expect(datasPrevistas([{ titulo: "x", dia: "lixo", duracao: null, valor: null }, { titulo: "y", dia: null, duracao: "nunca", valor: null }, { titulo: "z", dia: null, duracao: "1 dia", valor: null }], "2026-12-31").map((e) => e.dia)).toEqual([null, null, "2027-01-01"]);
    expect(duracaoEmDias("2 semanas")).toBe(14);
    expect(normalizarDuracao("x")).toBeNull();
  });
});
