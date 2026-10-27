// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";

const { exigirUsuario } = vi.hoisted(() => ({ exigirUsuario: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario }));

import { GET } from "./route";

const dbT = dbTeste();

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  exigirUsuario.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function semear() {
  const p = await dbT.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
  const u = await dbT.usuario.create({ data: { nome: "Vera Vendedora", email: "v@ij.test" } });
  const outro = await dbT.usuario.create({ data: { nome: "Outro", email: "o@ij.test" } });
  for (const [titulo, resp] of [["meu", u.id], ["dele", outro.id]] as const) {
    await dbT.oportunidade.create({ data: { titulo, pipelineId: p.id, faseId: p.fases[0].id, responsavelId: resp, criadoVia: "UI" } });
  }
  return { u, outro };
}

describe("GET /tabela/csv", () => {
  it("exige usuário (redirect do exigirUsuario passa intacto)", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    exigirUsuario.mockRejectedValue(redirect);
    await expect(GET(new Request("http://x/tabela/csv"))).rejects.toBe(redirect);
  });

  it("vendedor exporta tudo; filtros da URL valem; anexo CSV UTF-8", async () => {
    const { u, outro } = await semear();
    exigirUsuario.mockResolvedValue({ id: u.id, papel: "VENDEDOR" });
    const todos = await GET(new Request("http://x/tabela/csv"));
    expect(todos.status).toBe(200);
    expect(todos.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(todos.headers.get("content-disposition")).toMatch(/^attachment; filename="oportunidades-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = new Uint8Array(await todos.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texto = new TextDecoder().decode(bytes);
    expect(texto).toContain(";meu;");
    expect(texto).toContain(";dele;");

    const filtrado = await (await GET(new Request(`http://x/tabela/csv?resp=${outro.id}&pagina=3`))).text();
    expect(filtrado).toContain(";dele;");
    expect(filtrado).not.toContain(";meu;");
  });

  it("empresa mesclada sai com o nome da principal viva (regra do Kanban)", async () => {
    const { u } = await semear();
    exigirUsuario.mockResolvedValue({ id: u.id, papel: "VENDEDOR" });
    const principal = await dbT.empresa.create({ data: { nome: "Principal Viva" } });
    const dup = await dbT.empresa.create({ data: { nome: "Nome Antigo", mergedIntoId: principal.id } });
    await dbT.oportunidade.updateMany({ where: { titulo: "meu" }, data: { empresaId: dup.id } });
    const texto = await (await GET(new Request("http://x/tabela/csv?q=principal"))).text();
    expect(texto).toContain(";meu;");
    expect(texto).toContain(";Principal Viva;");
    expect(texto).not.toContain("Nome Antigo");
    expect(texto).not.toContain(";dele;");
  });

  it("falha no banco → 500 com ref, causa só no log", async () => {
    const { u } = await semear();
    exigirUsuario.mockResolvedValue({ id: u.id, papel: "VENDEDOR" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db.oportunidade, "findMany").mockRejectedValueOnce(new Error("conexão caiu"));
    const r = await GET(new Request("http://x/tabela/csv"));
    expect(r.status).toBe(500);
    const corpo = await r.text();
    const ref = /ref: ([0-9a-f]{8})/.exec(corpo)?.[1];
    expect(ref).toBeTruthy();
    expect(corpo).not.toContain("conexão caiu");
    expect(log.mock.calls[0][0]).toContain(`ref=${ref}`);
  });
});
