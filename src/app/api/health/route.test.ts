// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw } }));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("200 quando o banco responde", async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("503 sem vazar detalhes quando o banco falha", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 senha=xyz"));
    const res = await GET();
    expect(res.status).toBe(503);
    const corpo = await res.text();
    expect(JSON.parse(corpo)).toEqual({ status: "indisponivel" });
    expect(corpo).not.toMatch(/ECONNREFUSED|5432|senha/);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("não loga a mensagem do erro (pode conter host/credencial)", async () => {
    queryRaw.mockRejectedValue(new Error("senha=xyz"));
    await GET();
    const logado = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logado).not.toContain("senha=xyz");
  });

  it("503 quando o banco não responde dentro do prazo", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {}));
    const pendente = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pendente;
    expect(res.status).toBe(503);
  });
});
