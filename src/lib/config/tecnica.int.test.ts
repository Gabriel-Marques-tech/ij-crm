// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { grupoJid, limiarConfianca, provedorLlm, timeoutEnvioMs } from "./env";
import { definirSobrescritas } from "./sobrescritas";
import { carregarConfigTecnica, invalidarConfigTecnica, restaurarConfigTecnica, salvarConfigTecnica } from "./tecnica";

const dbT = dbTeste();
const envOriginal = { ...process.env };
let admin: { id: string; papel: "ADMIN" };
let gestor: { id: string; papel: "GESTOR" };

beforeEach(async () => {
  await limparBanco(["configuracao", "usuario"]);
  invalidarConfigTecnica();
  definirSobrescritas(undefined);
  for (const v of ["GRUPO_JID", "LLM_PROVEDOR", "LLM_EXTRACAO_MODELO", "LLM_LIMIAR_CONFIANCA", "LLM_LIMIAR_SEM_TAG", "EVOLUTION_TIMEOUT_ENVIO_MS"]) delete process.env[v];
  process.env.GRUPO_JID = "111111@g.us";
  const a = await dbT.usuario.create({ data: { nome: "Ana", email: "ana@ij.test", papel: "ADMIN" } });
  const g = await dbT.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "GESTOR" } });
  admin = { id: a.id, papel: "ADMIN" };
  gestor = { id: g.id, papel: "GESTOR" };
});

afterEach(() => {
  process.env = { ...envOriginal };
  invalidarConfigTecnica();
  definirSobrescritas(undefined);
  vi.restoreAllMocks();
});

describe("config técnica com cache", () => {
  it("salvar aplica na hora (sem reler o banco): config > env", async () => {
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("111111@g.us");
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us", limiarConfianca: 0.5, timeoutEnvioMs: 20000 }, admin, null);
    expect(r).toMatchObject({ ok: true });
    expect(grupoJid()).toBe("222222@g.us");
    expect(limiarConfianca()).toBe(0.5);
    expect(timeoutEnvioMs()).toBe(20000);
  });

  it("carrega do banco uma vez e reusa até invalidar", async () => {
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "333333@g.us" } } });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("333333@g.us");
    // Mudança direta no banco não é vista enquanto o cache vale…
    await dbT.configuracao.update({ where: { chave: "tecnica" }, data: { valor: { grupoJid: "444444@g.us" } } });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("333333@g.us");
    // …e é vista depois de invalidar.
    invalidarConfigTecnica();
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("444444@g.us");
  });

  it("restaurar volta ao env", async () => {
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null);
    expect(r.ok).toBe(true);
    expect(await restaurarConfigTecnica(admin)).toMatchObject({ ok: true });
    expect(grupoJid()).toBe("111111@g.us");
    expect(await dbT.configuracao.count()).toBe(0);
  });

  it("gestor não salva nem restaura (SEM_PERMISSAO) e nada muda", async () => {
    expect(await salvarConfigTecnica({ grupoJid: "222222@g.us" }, gestor, null)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await restaurarConfigTecnica(gestor)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await dbT.configuracao.count()).toBe(0);
  });

  it("combinação inválida é recusada em português e não grava", async () => {
    const r = await salvarConfigTecnica({ provedor: "anthropic", modeloExtracao: "gpt-6.1-sol" }, admin, null);
    expect(r).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS", mensagem: expect.stringMatching(/não é do provedor anthropic/) });
    const r2 = await salvarConfigTecnica({ limiarConfianca: 0.9, limiarSemTag: 0.5 }, admin, null);
    expect(r2).toMatchObject({ ok: false, mensagem: expect.stringMatching(/sem #crm/) });
    const r3 = await salvarConfigTecnica({ grupoJid: "5511999998888@s.whatsapp.net" }, admin, null);
    expect(r3).toMatchObject({ ok: false, mensagem: expect.stringMatching(/@g\.us/) });
    expect(await dbT.configuracao.count()).toBe(0);
    expect(provedorLlm()).toBe("openai");
  });

  it("concorrência otimista: versão velha → CONFLITO e o cache relê", async () => {
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null);
    expect(r.ok).toBe(true);
    expect(await salvarConfigTecnica({ grupoJid: "555555@g.us" }, admin, null)).toEqual({ ok: false, erro: "CONFLITO" });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("222222@g.us");
  });

  it("banco fora na carga: loga com ref, vale o env, e tenta de novo depois", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = await import("@/lib/db");
    vi.spyOn(db.configuracao, "findUnique").mockRejectedValueOnce(new Error("conexão recusada"));
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("111111@g.us");
    expect(erro.mock.calls.join(" ")).toMatch(/config\.tecnica\.carregar\] ref=/);
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "666666@g.us" } } });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("666666@g.us");
  });
});
