// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ usuarioAtual: vi.fn(), listarComentarios: vi.fn(), versaoDosComentarios: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual: m.usuarioAtual }));
vi.mock("@/lib/propostas/comentarios", () => ({ listarComentarios: m.listarComentarios, versaoDosComentarios: m.versaoDosComentarios }));

import { GET } from "./route";

const req = (q = "") => new Request(`http://localhost:3000/api/projetos/p1/comentarios${q}`);
const ctx = (id = "p1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.usuarioAtual.mockResolvedValue({ id: "u1", papel: "ADMIN", area: null, cargos: [] });
  m.versaoDosComentarios.mockResolvedValue("2.100");
  m.listarComentarios.mockResolvedValue({ versao: "2.100", threads: [{ id: "c1", texto: "oi" }] });
});

describe("GET /api/projetos/[id]/comentarios (polling)", () => {
  it("sem sessão → 401 e nada é consultado", async () => {
    m.usuarioAtual.mockResolvedValueOnce(null);
    const r = await GET(req(), ctx());
    expect(r.status).toBe(401);
    expect(m.listarComentarios).not.toHaveBeenCalled();
  });

  it("primeira carga (sem ?v): versão + comentários, sem cache (qualquer papel)", async () => {
    const r = await GET(req(), ctx());
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ versao: "2.100", comentarios: [{ id: "c1", texto: "oi" }] });
    expect(m.versaoDosComentarios).not.toHaveBeenCalled();
  });

  it("?v igual: só a versão (barato, sem listar)", async () => {
    const r = await GET(req("?v=2.100"), ctx());
    expect(await r.json()).toEqual({ versao: "2.100" });
    expect(m.listarComentarios).not.toHaveBeenCalled();
  });

  it("?v diferente: lista de novo", async () => {
    const r = await GET(req("?v=1.50"), ctx());
    expect((await r.json()).comentarios).toHaveLength(1);
  });

  it("sem proposta → 404", async () => {
    m.listarComentarios.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it("erro inesperado → 500 com a ref que está no log", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.listarComentarios.mockRejectedValueOnce(new Error("banco fora"));
    const r = await GET(req(), ctx());
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(erro.mock.calls.some((c) => String(c[0]).startsWith(`[api.comentarios] ref=${corpo.ref}`))).toBe(true);
  });

  it("GAB-98: quem não vê a proposta → 403, sem listar", async () => {
    m.usuarioAtual.mockResolvedValueOnce({ id: "u1", papel: "VISUALIZADOR", area: null, cargos: [] });
    const r = await GET(new Request("http://x/api/projetos/p1/comentarios"), { params: Promise.resolve({ id: "p1" }) });
    expect(r.status).toBe(403);
    expect(m.listarComentarios).not.toHaveBeenCalled();
  });

  it("o polling é por leitor: os pendentes de cada um só entram no carimbo e na lista dele (GAB-101)", async () => {
    await GET(req("?v=velha"), ctx());
    expect(m.versaoDosComentarios).toHaveBeenCalledWith("p1", expect.objectContaining({ id: "u1" }));
    expect(m.listarComentarios).toHaveBeenCalledWith("p1", expect.objectContaining({ id: "u1" }));
  });
});
