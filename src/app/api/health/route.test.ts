// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transaction,
    $executeRawUnsafe: vi.fn((sql: string) => ({ sql })),
    $queryRaw: vi.fn(() => ({ sql: "SELECT 1" })),
  },
}));

import { CACHE_MS, resetarCacheSaude } from "@/lib/health";
import { db } from "@/lib/db";
import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    transaction.mockReset();
    resetarCacheSaude();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("200 quando o banco responde", async () => {
    transaction.mockResolvedValue([0, [{ ok: 1 }]]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("consulta com statement_timeout curto dentro da transação", async () => {
    transaction.mockResolvedValue([0, [{ ok: 1 }]]);
    await GET();
    expect(vi.mocked(db.$executeRawUnsafe)).toHaveBeenCalledWith(expect.stringMatching(/^SET LOCAL statement_timeout = \d+$/));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("503 sem vazar detalhes quando o banco falha", async () => {
    transaction.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 senha=xyz"));
    const res = await GET();
    expect(res.status).toBe(503);
    const corpo = await res.text();
    expect(JSON.parse(corpo)).toEqual({ status: "indisponivel" });
    expect(corpo).not.toMatch(/ECONNREFUSED|5432|senha/);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("não loga a mensagem do erro (pode conter host/credencial)", async () => {
    transaction.mockRejectedValue(new Error("senha=xyz"));
    await GET();
    const logado = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logado).not.toContain("senha=xyz");
  });

  it("503 quando o banco não responde dentro do prazo", async () => {
    vi.useFakeTimers();
    transaction.mockReturnValue(new Promise(() => {}));
    const pendente = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pendente;
    expect(res.status).toBe(503);
  });

  it("reaproveita o resultado por 5s e coalesce chamadas simultâneas", async () => {
    vi.useFakeTimers();
    transaction.mockResolvedValue([0, [{ ok: 1 }]]);
    const simultaneas = await Promise.all([GET(), GET(), GET()]);
    expect(simultaneas.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(transaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CACHE_MS - 100);
    await GET();
    expect(transaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    await GET();
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("falha também fica em cache (não martela o banco caído)", async () => {
    transaction.mockRejectedValue(new Error("down"));
    expect((await GET()).status).toBe(503);
    expect((await GET()).status).toBe(503);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
