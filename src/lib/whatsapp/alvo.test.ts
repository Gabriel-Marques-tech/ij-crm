import { describe, expect, it } from "vitest";
import { MOTIVO_FECHADO_COM_ABERTO, MOTIVO_SEM_IDENTIDADE, resolverAlvo, type Candidata } from "./alvo";

const T = (min: number) => new Date(Date.UTC(2026, 9, 26, 12, min));

function c(id: string, p: Partial<Candidata> = {}): Candidata {
  return { id, terminal: false, tocadaEm: T(0), via: ["contato"], ...p };
}

describe("resolverAlvo — reply a uma confirmação fixa o alvo", () => {
  it("usa o card da confirmação mesmo que a LLM aponte outro", () => {
    const r = resolverAlvo({ alvoResposta: "a", escolhaLlm: "b", candidatas: [c("a", { via: ["resposta"] }), c("b")] });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "a", motivos: [] });
  });

  it("card da confirmação fechado → card novo reaberto + revisar", () => {
    const r = resolverAlvo({ alvoResposta: "a", escolhaLlm: null, candidatas: [c("a", { terminal: true, via: ["resposta"] })] });
    expect(r).toMatchObject({ tipo: "REABRIR", deId: "a" });
  });
});

describe("resolverAlvo — escolha da LLM só vale dentro da lista", () => {
  it("id da lista casado por identidade, aberto → ele, sem revisar", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("a", { via: ["recente"] }), c("b", { via: ["contato", "recente"] })] })).toEqual({
      tipo: "EXISTENTE",
      id: "b",
      motivos: [],
    });
  });

  it("único card recente (aberto) e a LLM escolheu ele → ✅ sem revisar (caso das mensagens picadas)", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("b", { via: ["recente"] })] })).toEqual({
      tipo: "EXISTENTE",
      id: "b",
      motivos: [],
    });
  });

  it("dois cards recentes → a escolha da LLM vale, mas com motivo (revisar)", () => {
    const r = resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("a", { via: ["recente"] }), c("b", { via: ["recente"] })] });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "b", motivos: [MOTIVO_SEM_IDENTIDADE] });
  });

  it("recente escolhido com outro recente FECHADO, ou com aberto por identidade → ambíguo, revisar", () => {
    expect(
      resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("x", { via: ["recente"], terminal: true }), c("b", { via: ["recente"] })] }),
    ).toMatchObject({ id: "b", motivos: [MOTIVO_SEM_IDENTIDADE] });
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("id1"), c("b", { via: ["recente"] })] })).toMatchObject({
      id: "b",
      motivos: [MOTIVO_SEM_IDENTIDADE],
    });
  });

  it("GAB-49: card só do ledger (mexido há mais de 30 min) pode ser escolhido, mas com revisar", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("b", { via: ["ledger"] })] })).toEqual({
      tipo: "EXISTENTE",
      id: "b",
      motivos: [MOTIVO_SEM_IDENTIDADE],
    });
    // Mesmo card recente E no ledger continua sendo um só.
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("b", { via: ["recente", "ledger"] })] })).toMatchObject({ motivos: [] });
  });

  it("GAB-49: ledger com OUTRO card aberto na janela → ambíguo, revisar (mesmo que só um seja dos últimos 30 min)", () => {
    expect(
      resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("a", { via: ["ledger"] }), c("b", { via: ["recente", "ledger"] })] }),
    ).toEqual({ tipo: "EXISTENTE", id: "b", motivos: [MOTIVO_SEM_IDENTIDADE] });
  });

  it("GAB-49: card fechado no ledger também concorre (como um recente fechado)", () => {
    expect(
      resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("x", { via: ["ledger"], terminal: true }), c("b", { via: ["recente"] })] }),
    ).toMatchObject({ id: "b", motivos: [MOTIVO_SEM_IDENTIDADE] });
  });

  it("GAB-49: card FECHADO só pelo ledger nunca reabre → NENHUM com motivo (vai para revisão)", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "x", candidatas: [c("x", { via: ["ledger"], terminal: true })] })).toEqual({
      tipo: "NENHUM",
      motivo: "FECHADO_SEM_IDENTIDADE",
    });
    // Com identidade exata (ou reply), a reabertura do GAB-38 continua.
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "x", candidatas: [c("x", { via: ["ledger", "contato"], terminal: true })] })).toMatchObject({
      tipo: "REABRIR",
      deId: "x",
    });
    expect(resolverAlvo({ alvoResposta: "x", escolhaLlm: null, candidatas: [c("x", { via: ["ledger", "resposta"], terminal: true })] })).toMatchObject({
      tipo: "REABRIR",
    });
  });

  it("GAB-49: ledger sozinho nunca decide sem a LLM (sem id → NENHUM)", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: null, candidatas: [c("b", { via: ["ledger"] })] })).toEqual({ tipo: "NENHUM" });
  });

  it("escolha só por 'dominio' → sempre com motivo (revisar)", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "b", candidatas: [c("b", { via: ["dominio"] })] })).toEqual({
      tipo: "EXISTENTE",
      id: "b",
      motivos: [MOTIVO_SEM_IDENTIDADE],
    });
  });

  it("LLM escolheu um fechado mas há aberto por identidade → o aberto + revisar (não reabre)", () => {
    const r = resolverAlvo({
      alvoResposta: null,
      escolhaLlm: "fechado",
      candidatas: [c("fechado", { terminal: true, tocadaEm: T(9) }), c("aberto", { tocadaEm: T(1) })],
    });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "aberto", motivos: [MOTIVO_FECHADO_COM_ABERTO] });
  });

  it("id fora da lista é ignorado (nunca confiar) e cai nas regras, marcando revisar", () => {
    const r = resolverAlvo({ alvoResposta: null, escolhaLlm: "inventado", candidatas: [c("a")] });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "a", motivos: ["card indicado pela leitura não confere com o CRM"] });
  });

  it("id fora da lista e nenhuma candidata por identidade → NENHUM", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: "x", candidatas: [c("a", { via: ["recente"] })] })).toEqual({ tipo: "NENHUM" });
  });

  it("LLM escolheu um fechado → reabre (card novo) + revisar", () => {
    const r = resolverAlvo({ alvoResposta: null, escolhaLlm: "a", candidatas: [c("a", { terminal: true })] });
    expect(r).toMatchObject({ tipo: "REABRIR", deId: "a" });
  });

  it("LLM escolheu um entre vários abertos do mesmo contato → ele, mas revisar", () => {
    const r = resolverAlvo({ alvoResposta: null, escolhaLlm: "a", candidatas: [c("a", { tocadaEm: T(1) }), c("b", { tocadaEm: T(5) })] });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "a", motivos: ["mais de um card aberto para esse contato/empresa"] });
  });
});

describe("resolverAlvo — regras do design doc (LLM sem id)", () => {
  it("1 aberta → ela, sem revisar (terminais do mesmo contato não atrapalham)", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: null, candidatas: [c("fechado", { terminal: true, tocadaEm: T(9) }), c("a")] })).toEqual({
      tipo: "EXISTENTE",
      id: "a",
      motivos: [],
    });
  });

  it(">1 aberta → a tocada mais recentemente + revisar", () => {
    const r = resolverAlvo({
      alvoResposta: null,
      escolhaLlm: null,
      candidatas: [c("velho", { tocadaEm: T(1) }), c("novo", { tocadaEm: T(7), via: ["empresa"] }), c("meio", { tocadaEm: T(4) })],
    });
    expect(r).toEqual({ tipo: "EXISTENTE", id: "novo", motivos: ["mais de um card aberto para esse contato/empresa"] });
  });

  it("só terminais → reabre a fechada mais recente (card novo com reaberta_de_id) + revisar", () => {
    const r = resolverAlvo({
      alvoResposta: null,
      escolhaLlm: null,
      candidatas: [c("p1", { terminal: true, tocadaEm: T(1) }), c("p2", { terminal: true, tocadaEm: T(3) })],
    });
    expect(r).toEqual({ tipo: "REABRIR", deId: "p2", motivos: ["card anterior estava fechado (ganho/perdido); abri um novo"] });
  });

  it("candidatas só por domínio ou recentes não decidem sozinhas (sem a LLM) → NENHUM", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: null, candidatas: [c("a", { via: ["dominio"] }), c("b", { via: ["recente"] })] })).toEqual({
      tipo: "NENHUM",
    });
  });

  it("sem candidatas → NENHUM", () => {
    expect(resolverAlvo({ alvoResposta: null, escolhaLlm: null, candidatas: [] })).toEqual({ tipo: "NENHUM" });
  });
});
