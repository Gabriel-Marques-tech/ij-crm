// @vitest-environment node
/**
 * Contexto de 12 h da LLM (GAB-49), ponta a ponta por `processarMensagem`:
 * ledger da janela atual + resumo da janela anterior no prompt, o card do
 * ledger como candidata, e nada disso bloqueando o pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { janelaAnterior, janelaDe } from "@/lib/contexto/janela";
import { saida } from "@/lib/llm/fixtures/extracao";
import { definirRespostaMock, definirResumoMock } from "@/lib/llm/provedores/mock";
import { ErroLlm, type PedidoExtracao } from "@/lib/llm/tipos";
import { dbTeste, limparBanco } from "@/test/db";
import { semear } from "../../../prisma/seed";
import { processarMensagem } from "./processar";

const dbT = dbTeste();
const TABELAS = ["resumo_janela", "timeline", "transicao_fase", "mensagem_enviada", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "mensagem_bruta", "usuario"];
const envOriginal = { ...process.env };
const MIN = 60_000;

let joao: { id: string };
let maria: { id: string };
let seq = 0;

async function bruta(texto: string, recebidaEm: Date, extra: Record<string, unknown> = {}) {
  seq++;
  return dbT.mensagemBruta.create({
    data: { eventoId: `C${seq}`, grupoJid: "g@g.us", texto, recebidaEm, remetenteUsuarioId: joao.id, status: "RECEBIDA", ...extra },
  });
}

async function enviar(texto: string, recebidaEm: Date, resposta: (p: PedidoExtracao) => unknown, extra: Record<string, unknown> = {}) {
  let prompt = "";
  definirRespostaMock((_, p) => {
    prompt = p.usuario;
    return resposta(p);
  });
  const m = await bruta(texto, recebidaEm, extra);
  const r = await processarMensagem(m.id);
  return { r, prompt };
}

function idVia(p: PedidoExtracao, via: string): string {
  const l = p.usuario.split("\n").find((x) => x.startsWith("- id=") && new RegExp(`via=\\S*${via}`).test(x));
  if (!l) throw new Error(`sem candidata via=${via}`);
  return /- id=(\S+)/.exec(l)![1];
}

beforeEach(async () => {
  await limparBanco(TABELAS);
  await semear(dbT, { log: () => {} });
  joao = await dbT.usuario.create({ data: { nome: "João", email: "joao@ij.test" } });
  maria = await dbT.usuario.create({ data: { nome: "Maria", email: "maria@ij.test" } });
  process.env.LLM_PROVEDOR = "mock";
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  definirRespostaMock(null);
  definirResumoMock(null);
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("ledger da janela atual no contexto", () => {
  it("mensagens picadas horas depois: histórico no prompt, card do ledger candidato (aplicado, com revisar)", async () => {
    const base = new Date("2026-10-27T11:00:00Z"); // 08:00 SP
    const c = await enviar("#crm falei com o Gustavo da Economia Sensata", base, () => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    const id = (c.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.timeline.updateMany({ where: { oportunidadeId: id }, data: { em: base } });
    await bruta("da Maria, outro lead", new Date(base.getTime() + MIN), { remetenteUsuarioId: maria.id, status: "PROCESSADA" });
    await bruta("bom dia grupo", new Date(base.getTime() + 2 * MIN), { status: "CLASSIFICADA_IRRELEVANTE" });

    // 2 h depois (fora dos 30 min de "recente"), mesma janela da manhã.
    const a = await enviar("#crm mando proposta sexta", new Date(base.getTime() + 120 * MIN), (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idVia(p, "ledger"), campos: { proxima_acao: "mandar proposta", proxima_acao_em: "sexta" } }),
    );
    expect(a.prompt).toContain(`<historico>\n- 27/10, 08:00 [card id=${id} "Gustavo — Economia Sensata"] #crm falei com o Gustavo da Economia Sensata\n</historico>`);
    expect(a.prompt).not.toContain("da Maria");
    expect(a.prompt).not.toContain("bom dia grupo");
    expect(a.prompt).toMatch(new RegExp(`- id=${id} .* via=ledger `));
    expect(a.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: id });
    const card = await dbT.oportunidade.findUniqueOrThrow({ where: { id } });
    expect(card).toMatchObject({ proximaAcao: "mandar proposta", revisar: true });
  });

  it("dentro dos 30 min e um card só na janela → ✅ sem revisar (regra do GAB-38 mantida)", async () => {
    const base = new Date("2026-10-27T11:00:00Z");
    const c = await enviar("#crm falei com o Gustavo da Economia Sensata", base, () => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    const id = (c.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.timeline.updateMany({ where: { oportunidadeId: id }, data: { em: base } });
    const a = await enviar("#crm mando proposta sexta", new Date(base.getTime() + 5 * MIN), (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idVia(p, "recente"), campos: { proxima_acao: "mandar proposta" } }),
    );
    expect(a.prompt).toMatch(new RegExp(`- id=${id} .* via=recente,ledger `));
    expect((await dbT.oportunidade.findUniqueOrThrow({ where: { id } })).revisar).toBe(false);
  });

  it("outro card do remetente na janela → o ✅ do único recente vira revisar", async () => {
    const base = new Date("2026-10-27T11:00:00Z");
    const ana = await enviar("#crm falei com a Ana da Alfa", base, () => saida({ contato: { nome: "Ana" }, empresa: { nome: "Alfa" } }));
    const idAna = (ana.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.timeline.updateMany({ where: { oportunidadeId: idAna }, data: { em: base } });
    const g = await enviar("#crm falei com o Gustavo da Economia Sensata", new Date(base.getTime() + 60 * MIN), () =>
      saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }),
    );
    const idG = (g.r as { oportunidadeId: string }).oportunidadeId;
    await dbT.timeline.updateMany({ where: { oportunidadeId: idG }, data: { em: new Date(base.getTime() + 60 * MIN) } });
    const a = await enviar("#crm mando proposta sexta", new Date(base.getTime() + 65 * MIN), (p) =>
      saida({ intencao: "ATUALIZAR", oportunidade_id: idVia(p, "recente"), campos: { proxima_acao: "mandar proposta" } }),
    );
    expect(a.r).toMatchObject({ tipo: "PROCESSADA", oportunidadeId: idG });
    expect((await dbT.oportunidade.findUniqueOrThrow({ where: { id: idG } })).revisar).toBe(true);
  });

  it("janela nova (12:00 SP) não carrega o ledger da manhã", async () => {
    const manha = new Date("2026-10-27T14:50:00Z"); // 11:50 SP
    await enviar("#crm falei com o Gustavo da Economia Sensata", manha, () => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    const t = await enviar("#crm mando proposta sexta", new Date("2026-10-27T15:05:00Z"), () => saida({ confianca: 0 }));
    expect(t.prompt).not.toContain("<historico>");
  });
});

describe("resumo da janela anterior no contexto", () => {
  it("1ª mensagem da janela NÃO espera o resumo: extrai sem ele; o resumo fica pronto em paralelo e entra na 2ª", async () => {
    const agora = new Date();
    await bruta("#crm falei com o Gustavo", new Date(janelaAnterior(agora).inicio.getTime() + MIN), { status: "PROCESSADA" });
    let soltar!: () => void;
    const portao = new Promise<void>((r) => (soltar = r));
    let resumoPronto = false;
    definirResumoMock(async () => {
      await portao; // só termina depois que a extração já rodou
      resumoPronto = true;
      return { resumo: "Gustavo (Economia Sensata): proposta sexta." };
    });
    let extraiuAntesDoResumo = false;
    const r1 = await enviar("#crm é da Economia Sensata", agora, () => {
      extraiuAntesDoResumo = !resumoPronto;
      soltar();
      return saida({ confianca: 0 });
    });
    expect(extraiuAntesDoResumo).toBe(true);
    expect(r1.prompt).not.toContain("<resumo_anterior>");
    expect(await dbT.resumoJanela.findFirstOrThrow()).toMatchObject({ status: "PRONTO" });

    const r2 = await enviar("#crm mando proposta sexta", new Date(agora.getTime() + 1000), () => saida({ confianca: 0 }));
    expect(r2.prompt).toContain("<resumo_anterior>\nGustavo (Economia Sensata): proposta sexta.\n</resumo_anterior>");
  });

  it("resumo ainda GERANDO (outro worker) → extrai sem ele e não dispara outra geração", async () => {
    const agora = new Date();
    await bruta("#crm x", new Date(janelaAnterior(agora).inicio.getTime() + MIN), { status: "PROCESSADA" });
    await dbT.resumoJanela.create({ data: { usuarioId: joao.id, janelaInicio: janelaAnterior(agora).inicio, status: "GERANDO", atualizadoEm: new Date() } });
    const fn = vi.fn(() => ({ resumo: "x" }));
    definirResumoMock(fn);
    const r = await enviar("#crm algo", agora, () => saida({ confianca: 0 }));
    expect(r.prompt).not.toContain("<resumo_anterior>");
    expect(fn).not.toHaveBeenCalled();
  });

  it("falha do resumo não bloqueia: a extração segue sem a seção", async () => {
    const agora = new Date();
    await bruta("#crm x", new Date(janelaAnterior(agora).inicio.getTime() + MIN), { status: "PROCESSADA" });
    definirResumoMock(() => {
      throw new ErroLlm("SEM_CREDITO");
    });
    const r = await enviar("#crm falei com o Gustavo da Economia Sensata", agora, () => saida({ contato: { nome: "Gustavo" }, empresa: { nome: "Economia Sensata" } }));
    expect(r.r).toMatchObject({ tipo: "PROCESSADA" });
    expect(r.prompt).not.toContain("<resumo_anterior>");
    expect(await dbT.resumoJanela.findFirstOrThrow()).toMatchObject({ status: "FALHA" });
  });

  it("mensagem antiga (reprocessada em outra janela) não gera resumo", async () => {
    const fn = vi.fn(() => ({ resumo: "x" }));
    definirResumoMock(fn);
    const velha = new Date("2026-10-20T15:00:00Z");
    await bruta("#crm anterior", new Date(janelaAnterior(velha).inicio.getTime() + MIN), { status: "PROCESSADA" });
    const r = await enviar("#crm algo", velha, () => saida({ confianca: 0 }));
    expect(fn).not.toHaveBeenCalled();
    expect(r.prompt).not.toContain("<resumo_anterior>");
    expect(janelaDe(velha).inicio.getTime()).toBeLessThan(Date.now());
  });
});
