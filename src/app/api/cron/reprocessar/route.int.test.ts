// @vitest-environment node
// GAB-41: POST /api/cron/reprocessar — segredo forte em tempo constante, lock, só contagens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES_EXTRACAO, RECEBIDA_EM } from "@/lib/llm/fixtures/extracao";
import { definirRespostaMock } from "@/lib/llm/provedores/mock";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../../../prisma/seed";
import { POST } from "./route";

const dbT = dbTeste();
const SEGREDO = "c".repeat(40);
const envOriginal = { ...process.env };
const TABELAS = [
  "trava_cron",
  "alerta_operacional",
  "import_previa",
  "timeline",
  "transicao_fase",
  "mensagem_enviada",
  "oportunidade",
  "contato_ponto",
  "contato",
  "empresa",
  "fase",
  "pipeline",
  "mensagem_bruta",
  "inbox_evento",
  "sessao",
  "usuario",
];

function req(segredo?: string) {
  return new Request("http://localhost/api/cron/reprocessar", { method: "POST", headers: segredo === undefined ? {} : { "x-cron-secret": segredo } });
}

let joao: { id: string };

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  process.env.LLM_PROVEDOR = "mock";
  process.env.CRON_SECRET = SEGREDO;
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("autenticação (falha fechado)", () => {
  it.each([
    ["sem header", undefined],
    ["segredo errado", "d".repeat(40)],
    ["prefixo do certo", SEGREDO.slice(0, 39)],
  ])("%s → 401", async (_, s) => {
    const r = await POST(req(s));
    expect(r.status).toBe(401);
  });

  it.each([
    ["ausente", undefined],
    ["placeholder", "troque-me-openssl-rand-hex-32-xxxxxxxxxxxxxx"],
    ["curto", "abc"],
  ])("CRON_SECRET %s → 401 até para quem manda o mesmo valor", async (_, v) => {
    if (v === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = v;
    const r = await POST(req(v ?? ""));
    expect(r.status).toBe(401);
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat())).toContain("CRON_SECRET");
  });
});

describe("execução", () => {
  it("processa órfã, purga prévia vencida, apaga sessão expirada; resposta só com contagens", async () => {
    const m = await dbT.mensagemBruta.create({
      data: { eventoId: "EVT-C1", grupoJid: "g@g.us", texto: FIXTURES_EXTRACAO[0].texto, recebidaEm: RECEBIDA_EM, remetenteUsuarioId: joao.id, remetenteTelefone: "+5511999998888" },
    });
    await dbT.$executeRaw`UPDATE mensagem_bruta SET atualizado_em = now() - interval '10 minutes' WHERE id = ${m.id}`;
    await dbT.importPrevia.create({ data: { id: "p1", usuarioId: joao.id, hash: "h", nomeArquivo: "a.csv", conteudo: "x", mapeamento: {}, expiraEm: new Date(Date.now() - 1000) } });
    await dbT.sessao.create({ data: { id: "s".repeat(64), usuarioId: joao.id, expiraEm: new Date(Date.now() - 1000) } });

    const r = await POST(req(SEGREDO));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: true, reprocessamento: { tentadas: 1, processadas: 1 }, previasPurgadas: 1, sessoesExpiradas: 1, retencao: { mensagens: 0, timeline: 0 } });
    const texto = JSON.stringify(corpo);
    expect(texto).not.toContain("Gustavo");
    expect(texto).not.toContain("5511");
    expect(texto).not.toContain(m.id);
    expect((await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("PROCESSADA");
  });

  it("ERRO no reprocessamento (config/banco fora) → 500 com a ref, como documentado", async () => {
    const m = await dbT.mensagemBruta.create({
      data: { eventoId: "EVT-C3", grupoJid: "g@g.us", texto: FIXTURES_EXTRACAO[0].texto, recebidaEm: RECEBIDA_EM, remetenteUsuarioId: joao.id },
    });
    await dbT.$executeRaw`UPDATE mensagem_bruta SET atualizado_em = now() - interval '10 minutes' WHERE id = ${m.id}`;
    const tecnica = await import("@/lib/config/tecnica");
    vi.spyOn(tecnica, "carregarConfigTecnica").mockResolvedValue({ ok: false, ref: "cafe0002" } as never);
    const r = await POST(req(SEGREDO));
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ erros: ["cafe0002"], reprocessamento: { erros: 1 } });
  });

  it("duas execuções ao mesmo tempo nunca se sobrepõem (advisory lock)", async () => {
    let soltar: () => void = () => {};
    const segura = new Promise<void>((ok) => (soltar = ok));
    definirRespostaMock(async () => {
      await segura;
      return FIXTURES_EXTRACAO[0].saida;
    });
    const m = await dbT.mensagemBruta.create({
      data: { eventoId: "EVT-C2", grupoJid: "g@g.us", texto: FIXTURES_EXTRACAO[0].texto, recebidaEm: RECEBIDA_EM, remetenteUsuarioId: joao.id },
    });
    await dbT.$executeRaw`UPDATE mensagem_bruta SET atualizado_em = now() - interval '10 minutes' WHERE id = ${m.id}`;

    const primeira = POST(req(SEGREDO));
    // Espera a 1ª chegar na LLM (segurando o lock).
    for (let i = 0; i < 100 && (await dbT.mensagemBruta.findUniqueOrThrow({ where: { id: m.id } })).status !== "PROCESSANDO"; i++) {
      await new Promise((ok) => setTimeout(ok, 20));
    }
    const segunda = await POST(req(SEGREDO));
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toEqual({ ok: true, emAndamento: true });
    soltar();
    const r1 = await primeira;
    expect((await r1.json()).reprocessamento.processadas).toBe(1);
    // Lock liberado: a próxima roda normalmente.
    expect((await (await POST(req(SEGREDO))).json()).emAndamento).toBeUndefined();
  });
});
