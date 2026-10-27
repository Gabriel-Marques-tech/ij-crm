// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirResumoMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { janelaAnterior, janelaDe } from "./janela";
import { aplicarRetencaoResumos, gerarResumosPendentes, resumoJanelaAnterior } from "./resumo";

const dbT = dbTeste();
const TABELAS = ["resumo_janela", "timeline", "mensagem_bruta", "usuario"];
const AGORA = new Date("2026-10-27T16:00:00Z"); // 13:00 SP → janela da tarde; anterior = manhã (03:00Z–15:00Z)
const ANTERIOR = janelaAnterior(AGORA);
const envOriginal = { ...process.env };

let joao: { id: string };
let maria: { id: string };
let seq = 0;

async function bruta(usuarioId: string, texto: string, recebidaEm: Date, extra: Record<string, unknown> = {}) {
  seq++;
  return dbT.mensagemBruta.create({ data: { eventoId: `R${seq}`, grupoJid: "g@g.us", texto, recebidaEm, remetenteUsuarioId: usuarioId, status: "PROCESSADA", ...extra } });
}

const naAnterior = (min: number) => new Date(ANTERIOR.inicio.getTime() + min * 60_000);

beforeEach(async () => {
  await limparBanco(TABELAS);
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test" } });
  maria = await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  process.env.LLM_PROVEDOR = "mock";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirResumoMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("resumoJanelaAnterior — gerado sob demanda, idempotente, nunca lança", () => {
  it("sem mensagens de venda na janela anterior → null, sem linha e sem LLM", async () => {
    const fn = vi.fn(() => ({ resumo: "x" }));
    definirResumoMock(fn);
    await bruta(joao.id, "irrelevante", naAnterior(10), { status: "CLASSIFICADA_IRRELEVANTE" });
    await bruta(joao.id, "desta janela", AGORA);
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(await dbT.resumoJanela.count()).toBe(0);
  });

  it("gera uma vez (sem telefone/email) e depois só lê", async () => {
    const fn = vi.fn((_t: string, p: { usuario: string }) => {
      expect(p.usuario).toContain("falei com o Gustavo");
      expect(p.usuario).not.toContain("da Maria");
      return { resumo: "Gustavo (Economia Sensata): proposta sexta. Tel 11 99999-8888, gustavo@x.com" };
    });
    definirResumoMock(fn);
    await bruta(joao.id, "falei com o Gustavo", naAnterior(60));
    await bruta(maria.id, "da Maria", naAnterior(70));
    const r1 = await resumoJanelaAnterior(joao.id, AGORA);
    expect(r1).toBe("Gustavo (Economia Sensata): proposta sexta. Tel [número], [email]");
    expect(await resumoJanelaAnterior(joao.id, new Date(AGORA.getTime() + 3600_000))).toBe(r1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await dbT.resumoJanela.findMany()).toMatchObject([{ usuarioId: joao.id, janelaInicio: ANTERIOR.inicio, status: "PRONTO", tentativas: 1, texto: r1 }]);
    const log = (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(log).toMatch(/\[llm\] resumo ref=\S+ provedor=mock .*versao=resumo\.v1 .* ok/);
    expect(log).not.toMatch(/Gustavo|9999/);
  });

  it("concorrência na virada: duas mensagens do mesmo vendedor → um resumo, uma chamada", async () => {
    let soltar!: () => void;
    const portao = new Promise<void>((r) => (soltar = r));
    const fn = vi.fn(async () => {
      await portao;
      return { resumo: "único" };
    });
    definirResumoMock(fn);
    await bruta(joao.id, "x", naAnterior(1));
    const a = resumoJanelaAnterior(joao.id, AGORA);
    const b = resumoJanelaAnterior(joao.id, AGORA);
    await new Promise((r) => setTimeout(r, 200));
    soltar();
    const rs = await Promise.all([a, b]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(rs.filter((r) => r === "único")).toHaveLength(1);
    expect(rs).toContain(null); // quem perdeu segue sem resumo, sem esperar
    expect(await dbT.resumoJanela.count()).toBe(1);
  });

  it("falha da LLM → null + FALHA com ref (sem texto); tenta de novo depois, no máximo 3 vezes", async () => {
    const fn = vi.fn(() => {
      throw new ErroLlm("TIMEOUT");
    });
    definirResumoMock(fn);
    await bruta(joao.id, "x", naAnterior(1));
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    const linha = await dbT.resumoJanela.findFirstOrThrow();
    expect(linha).toMatchObject({ status: "FALHA", tentativas: 1, texto: null });
    expect(linha.erro).toMatch(/^LLM_TIMEOUT ref=\S+$/);
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
    definirResumoMock(() => ({ resumo: "ok" }));
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull(); // desistiu nesta janela
  });

  it("FALHA seguida de sucesso → PRONTO", async () => {
    let n = 0;
    definirResumoMock(() => {
      if (n++ === 0) throw new ErroLlm("REDE");
      return { resumo: "depois" };
    });
    await bruta(joao.id, "x", naAnterior(1));
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBe("depois");
    expect(await dbT.resumoJanela.findFirstOrThrow()).toMatchObject({ status: "PRONTO", tentativas: 2, erro: null });
  });

  it("GERANDO abandonado (processo morreu) há mais de 5 min é reivindicado de novo; recente não", async () => {
    await bruta(joao.id, "x", naAnterior(1));
    const linha = await dbT.resumoJanela.create({ data: { usuarioId: joao.id, janelaInicio: ANTERIOR.inicio, status: "GERANDO", atualizadoEm: new Date() } });
    definirResumoMock(() => ({ resumo: "novo" }));
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBeNull();
    await dbT.resumoJanela.update({ where: { id: linha.id }, data: { atualizadoEm: new Date(Date.now() - 6 * 60_000) } });
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBe("novo");
  });
});

describe("retenção: só o resumo da janela anterior fica", () => {
  it("gerar o da janela anterior apaga os mais antigos (de todos os vendedores)", async () => {
    const velha = janelaAnterior(ANTERIOR.inicio);
    await dbT.resumoJanela.create({ data: { usuarioId: joao.id, janelaInicio: velha.inicio, status: "PRONTO", texto: "velho" } });
    await dbT.resumoJanela.create({ data: { usuarioId: maria.id, janelaInicio: velha.inicio, status: "PRONTO", texto: "velho" } });
    await dbT.resumoJanela.create({ data: { usuarioId: maria.id, janelaInicio: ANTERIOR.inicio, status: "PRONTO", texto: "da Maria" } });
    await bruta(joao.id, "x", naAnterior(1));
    expect(await resumoJanelaAnterior(joao.id, AGORA)).toBe("mock: resumo da janela anterior");
    const restam = await dbT.resumoJanela.findMany({ orderBy: { texto: "asc" } });
    expect(restam.map((r) => r.janelaInicio.getTime())).toEqual([ANTERIOR.inicio.getTime(), ANTERIOR.inicio.getTime()]);
  });

  it("aplicarRetencaoResumos (para o cron) apaga o que é mais antigo que a janela anterior", async () => {
    const velha = janelaAnterior(ANTERIOR.inicio);
    await dbT.resumoJanela.create({ data: { usuarioId: joao.id, janelaInicio: velha.inicio, status: "FALHA" } });
    await dbT.resumoJanela.create({ data: { usuarioId: joao.id, janelaInicio: ANTERIOR.inicio, status: "PRONTO", texto: "fica" } });
    expect(await aplicarRetencaoResumos(AGORA)).toBe(1);
    expect(await dbT.resumoJanela.findMany()).toMatchObject([{ texto: "fica" }]);
  });
});

describe("gerarResumosPendentes (para o cron do GAB-41)", () => {
  it("gera para cada vendedor com venda na janela anterior; repetir não gera de novo", async () => {
    const fn = vi.fn(() => ({ resumo: "r" }));
    definirResumoMock(fn);
    await bruta(joao.id, "a", naAnterior(1));
    await bruta(maria.id, "b", naAnterior(2));
    await bruta(maria.id, "c", janelaDe(AGORA).inicio);
    expect(await gerarResumosPendentes(AGORA)).toEqual({ gerados: 2 });
    expect(await gerarResumosPendentes(AGORA)).toEqual({ gerados: 0 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
