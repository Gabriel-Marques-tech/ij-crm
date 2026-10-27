// @vitest-environment node
// GAB-46: o pipeline aciona o alerta de sem crédito e desliga o banner quando a LLM volta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estadoSemCredito, textoAlertaSemCredito } from "@/lib/llm/alerta-credito";
import { FIXTURES_EXTRACAO, RECEBIDA_EM } from "@/lib/llm/fixtures/extracao";
import { definirRespostaMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { processarMensagem } from "./processar";

const dbT = dbTeste();
const GRUPO = "120363000000000001@g.us";
const OPS = "120363000000000099@g.us";
const TABELAS = [
  "alerta_operacional",
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
const envOriginal = { ...process.env };
const TEXTO_SECRETO = "#crm Gustavo segredo da Economia Sensata";

let joao: { id: string };
let seq = 0;
let enviados: { number: string; text: string }[] = [];

async function bruta(texto: string) {
  seq++;
  return dbT.mensagemBruta.create({
    data: { eventoId: `EVT-AC${seq}`, grupoJid: GRUPO, texto, recebidaEm: RECEBIDA_EM, remetenteTelefone: "+5511999998888", remetenteUsuarioId: joao.id },
  });
}

function logs(): string {
  return [console.info, console.warn, console.error]
    .map((s) => (s as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n"))
    .join("\n");
}

const semCredito = () => {
  throw new ErroLlm("SEM_CREDITO", { status: 402 });
};

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test", telefoneWhatsapp: "+5511999998888" } });
  process.env.LLM_PROVEDOR = "mock";
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.ALERTA_OPS_JID = OPS;
  process.env.EVOLUTION_API_URL = "http://evolution.test";
  process.env.EVOLUTION_API_KEY = "k".repeat(40);
  process.env.EVOLUTION_INSTANCE = "ij-crm";
  enviados = [];
  // Evolution falsa: registra o que seria enviado e devolve um key.id.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const corpo = JSON.parse(init.body) as { number: string; text: string };
      enviados.push(corpo);
      return new Response(JSON.stringify({ key: { id: `OUT${enviados.length}` } }), { status: 200 });
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("processarMensagem + alerta de sem crédito", () => {
  it("1º SEM_CREDITO avisa ops uma vez; o 2º (no cooldown) não; banner liga", async () => {
    definirRespostaMock(semCredito);
    const r1 = await processarMensagem((await bruta(TEXTO_SECRETO)).id);
    const r2 = await processarMensagem((await bruta(TEXTO_SECRETO)).id);
    expect(r1).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
    expect(r2).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
    if (r1.tipo !== "FALHA") throw new Error();

    const paraOps = enviados.filter((e) => e.number === OPS);
    expect(paraOps).toEqual([{ number: OPS, text: textoAlertaSemCredito(r1.ref) }]);
    // O grupo continua recebendo o ❌ de cada mensagem.
    expect(enviados.filter((e) => e.number === GRUPO)).toHaveLength(2);
    expect(await estadoSemCredito()).not.toBeNull();
    // Nem o aviso nem os logs levam o texto da mensagem.
    expect(paraOps[0].text).not.toContain("segredo");
    expect(logs()).not.toContain("segredo");
  });

  it("banner some quando uma chamada volta a dar certo", async () => {
    definirRespostaMock(semCredito);
    await processarMensagem((await bruta(TEXTO_SECRETO)).id);
    expect(await estadoSemCredito()).not.toBeNull();

    definirRespostaMock(null);
    const f = FIXTURES_EXTRACAO[0];
    await processarMensagem((await bruta(f.texto)).id);
    expect(await estadoSemCredito()).toBeNull();
  });

  it("falha no envio do alerta não afeta o resultado do processamento", async () => {
    definirRespostaMock(semCredito);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const corpo = JSON.parse(init.body) as { number: string };
        if (corpo.number === OPS) return new Response("{}", { status: 500 });
        return new Response(JSON.stringify({ key: { id: "OK" } }), { status: 200 });
      }),
    );
    const r = await processarMensagem((await bruta(TEXTO_SECRETO)).id);
    expect(r).toMatchObject({ tipo: "FALHA", codigo: "LLM_SEM_CREDITO" });
  });

  it("outros erros de LLM não avisam ops", async () => {
    definirRespostaMock(() => {
      throw new ErroLlm("TIMEOUT");
    });
    await processarMensagem((await bruta(TEXTO_SECRETO)).id);
    expect(enviados.filter((e) => e.number === OPS)).toHaveLength(0);
    expect(await estadoSemCredito()).toBeNull();
  });
});
