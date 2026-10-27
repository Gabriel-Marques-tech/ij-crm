// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estadoConexao, ErroEvolutionAdmin, listarGrupos, obterQr, TIMEOUT_ADMIN_MS } from "./evolution-admin";

const envOriginal = { ...process.env };
const CHAVE = "chave-evolution-de-teste-0123456789abcdef";
const QR = "data:image/png;base64,QRSECRETOAAAA";

beforeEach(() => {
  process.env.EVOLUTION_API_URL = "http://evolution.test:8080/";
  process.env.EVOLUTION_API_KEY = CHAVE;
  process.env.EVOLUTION_INSTANCE = "ij crm";
});

afterEach(() => {
  process.env = { ...envOriginal };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("Evolution (Admin)", () => {
  it("listarGrupos: GET /group/fetchAllGroups sem participantes, ordena por nome", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      resposta([
        { id: "222@g.us", subject: "Zeta", size: 3, participants: [{ id: "5511999998888@s.whatsapp.net" }] },
        { id: "111@g.us", subject: "Alfa time IJ", size: 12 },
        { id: "lixo" },
      ]),
    );
    expect(await listarGrupos()).toEqual([
      { jid: "111@g.us", nome: "Alfa time IJ", membros: 12 },
      { jid: "222@g.us", nome: "Zeta", membros: 3 },
    ]);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("http://evolution.test:8080/group/fetchAllGroups/ij%20crm?getParticipants=false");
    expect((init as RequestInit).headers).toMatchObject({ apikey: CHAVE });
    expect((init as RequestInit).cache).toBe("no-store");
  });

  it.each([
    ["open", "CONECTADO"],
    ["connecting", "AGUARDANDO_QR"],
    ["close", "DESCONECTADO"],
    ["outra", "DESCONHECIDO"],
  ])("estadoConexao: state=%s → %s", async (state, esperado) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta({ instance: { instanceName: "ij crm", state } }));
    expect(await estadoConexao()).toBe(esperado);
  });

  it("obterQr: devolve o base64 e nunca o loga; conectada → null", async () => {
    const espioes = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resposta({ pairingCode: null, code: "2@abc", base64: QR, count: 1 }));
    expect(await obterQr()).toEqual({ base64: QR });
    expect(String(f.mock.calls[0][0])).toBe("http://evolution.test:8080/instance/connect/ij%20crm");
    f.mockResolvedValueOnce(resposta({ instance: { instanceName: "ij crm", state: "open" } }));
    expect(await obterQr()).toBeNull();
    for (const e of espioes) expect(JSON.stringify(e.mock.calls)).not.toContain("QRSECRETO");
  });

  it("HTTP de erro e timeout viram ErroEvolutionAdmin com motivo legível", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(resposta({ message: "x" }, 401));
    await expect(estadoConexao()).rejects.toThrow(/HTTP 401/);

    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_u, init) => new Promise((_, rej) => (init as RequestInit).signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))),
    );
    const p = listarGrupos();
    const verif = expect(p).rejects.toBeInstanceOf(ErroEvolutionAdmin);
    await vi.advanceTimersByTimeAsync(TIMEOUT_ADMIN_MS);
    await verif;
    await expect(p).rejects.toThrow(/timeout/);
  });

  it("sem configuração da Evolution: erro claro sem chamar a rede", async () => {
    delete process.env.EVOLUTION_API_URL;
    const f = vi.spyOn(globalThis, "fetch");
    await expect(estadoConexao()).rejects.toThrow(/EVOLUTION_API_URL/);
    expect(f).not.toHaveBeenCalled();
  });
});
