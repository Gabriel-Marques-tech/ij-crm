// GAB-41 (review): orquestração do cron — trava, passos isolados, refs de ERRO viram 500.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  pegarTrava: vi.fn(),
  soltarTrava: vi.fn(),
  retomarPendentes: vi.fn(),
  apagarJsonLlmVencido: vi.fn(),
  apagarSemTagNaoConfirmadas: vi.fn(),
  purgarVencidas: vi.fn(),
  apagarSessoesExpiradas: vi.fn(),
  gerarResumosPendentes: vi.fn(),
  aplicarRetencaoResumos: vi.fn(),
}));

vi.mock("./trava", () => ({ pegarTrava: m.pegarTrava, soltarTrava: m.soltarTrava }));
vi.mock("@/lib/whatsapp/reprocessar", () => ({ retomarPendentes: m.retomarPendentes, PRAZO_EXECUCAO_MS: 240_000 }));
vi.mock("@/lib/whatsapp/retencao", () => ({ apagarJsonLlmVencido: m.apagarJsonLlmVencido, apagarSemTagNaoConfirmadas: m.apagarSemTagNaoConfirmadas }));
vi.mock("@/lib/importacao/pipefy/servico", () => ({ purgarVencidas: m.purgarVencidas }));
vi.mock("@/lib/auth/sessao", () => ({ apagarSessoesExpiradas: m.apagarSessoesExpiradas }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/contexto/resumo", () => ({ gerarResumosPendentes: m.gerarResumosPendentes, aplicarRetencaoResumos: m.aplicarRetencaoResumos }));

const { rodarManutencao, DURACAO_TRAVA_MS, PRAZO_RESUMOS_MS } = await import("./manutencao");

const RETOMADA = { esgotadas: 0, destravadas: 0, tentadas: 1, processadas: 0, pendentes: 0, descartadas: 0, falhas: 0, ignoradas: 0, erros: 0, interrompida: false, refs: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.pegarTrava.mockResolvedValue("dono-1");
  m.retomarPendentes.mockResolvedValue(RETOMADA);
  m.apagarJsonLlmVencido.mockResolvedValue({ mensagens: 0, timeline: 0 });
  m.apagarSemTagNaoConfirmadas.mockResolvedValue(3);
  m.purgarVencidas.mockResolvedValue(0);
  m.apagarSessoesExpiradas.mockResolvedValue(0);
  m.gerarResumosPendentes.mockResolvedValue({ gerados: 2, interrompido: false });
  m.aplicarRetencaoResumos.mockResolvedValue(5);
});

describe("rodarManutencao", () => {
  it("trava ocupada → EM_ANDAMENTO sem rodar nada", async () => {
    m.pegarTrava.mockResolvedValue(null);
    expect(await rodarManutencao()).toEqual({ tipo: "EM_ANDAMENTO" });
    expect(m.retomarPendentes).not.toHaveBeenCalled();
    expect(m.soltarTrava).not.toHaveBeenCalled();
  });

  it("aluguel da trava bem acima do prazo de trabalho (4 min)", async () => {
    await rodarManutencao();
    expect(m.pegarTrava).toHaveBeenCalledWith("reprocessar", DURACAO_TRAVA_MS);
    expect(DURACAO_TRAVA_MS).toBeGreaterThanOrEqual(2 * 240_000);
  });

  it("ERRO no reprocessamento → refs em `erros` (rota responde 500)", async () => {
    m.retomarPendentes.mockResolvedValue({ ...RETOMADA, erros: 1, interrompida: true, refs: ["cafe0001"] });
    const r = await rodarManutencao();
    if (r.tipo !== "OK") throw new Error();
    expect(r.resumo.erros).toEqual(["cafe0001"]);
    expect(m.soltarTrava).toHaveBeenCalledWith("reprocessar", "dono-1");
  });

  it("passo que lança não derruba os outros; trava solta mesmo assim", async () => {
    m.apagarJsonLlmVencido.mockRejectedValue(new Error("db"));
    const r = await rodarManutencao();
    if (r.tipo !== "OK") throw new Error();
    expect(r.resumo.retencao).toBeNull();
    expect(r.resumo.semTagApagadas).toBe(3);
    expect(r.resumo.erros).toHaveLength(1);
    expect(m.retomarPendentes).toHaveBeenCalled();
    expect(m.soltarTrava).toHaveBeenCalledTimes(1);
  });

  it("GAB-49: resumos das janelas fechadas e retenção dos resumos, só contagens; prazo dentro dos 4 min", async () => {
    const r = await rodarManutencao();
    if (r.tipo !== "OK") throw new Error();
    expect(r.resumo.resumos).toEqual({ gerados: 2, interrompido: false });
    expect(r.resumo.resumosApagados).toBe(5);
    const [agora, opts] = m.gerarResumosPendentes.mock.calls[0] as [Date, { prazoMs: number }];
    expect(agora).toBeInstanceOf(Date);
    expect(opts.prazoMs).toBe(PRAZO_RESUMOS_MS);
    expect(PRAZO_RESUMOS_MS).toBeLessThanOrEqual(90_000);
    // Resumos antes do reprocessamento (o contexto das reprocessadas já vê o resumo),
    // e o reprocessamento recebe o prazo global (início + 4 min), não um novo.
    expect(m.gerarResumosPendentes.mock.invocationCallOrder[0]).toBeLessThan(m.retomarPendentes.mock.invocationCallOrder[0]);
    const prazo = (m.retomarPendentes.mock.calls[0][0] as { prazo: Date }).prazo;
    expect(prazo.getTime() - Date.now()).toBeLessThanOrEqual(240_000);
  });

  it("falha nos resumos não derruba o resto", async () => {
    m.gerarResumosPendentes.mockRejectedValue(new Error("x"));
    m.aplicarRetencaoResumos.mockRejectedValue(new Error("y"));
    const r = await rodarManutencao();
    if (r.tipo !== "OK") throw new Error();
    expect(r.resumo).toMatchObject({ resumos: null, resumosApagados: null });
    expect(r.resumo.erros).toHaveLength(2);
    expect(m.retomarPendentes).toHaveBeenCalled();
  });
});
