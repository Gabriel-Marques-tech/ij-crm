// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { grupoJid, limiarConfianca, provedorLlm, timeoutEnvioMs } from "./env";
import { definirSobrescritas } from "./sobrescritas";
import { ErroEvolutionAdmin } from "@/lib/whatsapp/evolution-admin";
import { carregarConfigTecnica, invalidarConfigTecnica, restaurarConfigTecnica, salvarConfigTecnica } from "./tecnica";

/** Evolution falsa: grupos em que a instância está. */
const evo = (jids: string[]) => ({ listarGrupos: vi.fn(async () => jids.map((jid) => ({ jid, nome: "G", membros: 3 }))) });
const GRUPOS = () => evo(["111111@g.us", "222222@g.us", "555555@g.us"]);

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
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us", limiarConfianca: 0.5, timeoutEnvioMs: 20000 }, admin, null, GRUPOS());
    expect(r).toMatchObject({ ok: true });
    expect(grupoJid()).toBe("222222@g.us");
    expect(limiarConfianca()).toBe(0.5);
    expect(timeoutEnvioMs()).toBe(20000);
  });

  it("sem nada salvo e sem GRUPO_JID no env (dev) não acusa config salva inválida", async () => {
    delete process.env.GRUPO_JID;
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await carregarConfigTecnica()).toEqual({ ok: true });
    expect(erro.mock.calls.some((c) => String(c[0]).includes("config.tecnica.carregar"))).toBe(false);
    expect(grupoJid()).toBeFalsy();
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
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null, GRUPOS());
    expect(r.ok).toBe(true);
    const versao = (await dbT.configuracao.findUniqueOrThrow({ where: { chave: "tecnica" } })).atualizadoEm;
    expect(await restaurarConfigTecnica(admin, versao)).toMatchObject({ ok: true });
    expect(grupoJid()).toBe("111111@g.us");
    expect(await dbT.configuracao.count()).toBe(0);
  });

  it("gestor não salva nem restaura (SEM_PERMISSAO) e nada muda", async () => {
    expect(await salvarConfigTecnica({ grupoJid: "222222@g.us" }, gestor, null, GRUPOS())).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await restaurarConfigTecnica(gestor, null)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await dbT.configuracao.count()).toBe(0);
  });

  it("combinação inválida é recusada em português e não grava", async () => {
    const r = await salvarConfigTecnica({ provedor: "anthropic", modeloExtracao: "gpt-6.1-sol" }, admin, null, GRUPOS());
    expect(r).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS", mensagem: expect.stringMatching(/não é do provedor anthropic/) });
    const r2 = await salvarConfigTecnica({ limiarConfianca: 0.9, limiarSemTag: 0.5 }, admin, null, GRUPOS());
    expect(r2).toMatchObject({ ok: false, mensagem: expect.stringMatching(/sem #crm/) });
    const r3 = await salvarConfigTecnica({ grupoJid: "5511999998888@s.whatsapp.net" }, admin, null, GRUPOS());
    expect(r3).toMatchObject({ ok: false, mensagem: expect.stringMatching(/@g\.us/) });
    expect(await dbT.configuracao.count()).toBe(0);
    expect(provedorLlm()).toBe("openai");
  });

  it("concorrência otimista: versão velha → CONFLITO e o cache relê", async () => {
    const r = await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null, GRUPOS());
    expect(r.ok).toBe(true);
    expect(await salvarConfigTecnica({ grupoJid: "555555@g.us" }, admin, null, GRUPOS())).toEqual({ ok: false, erro: "CONFLITO" });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("222222@g.us");
  });

  it("banco fora na carga: loga com ref, vale o env, e tenta de novo depois", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = await import("@/lib/db");
    vi.spyOn(db.configuracao, "findUnique").mockRejectedValueOnce(new Error("conexão recusada"));
    expect(await carregarConfigTecnica()).toMatchObject({ ok: false, ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(grupoJid()).toBe("111111@g.us");
    expect(erro.mock.calls.join(" ")).toMatch(/config\.tecnica\.carregar\] ref=/);
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "666666@g.us" } } });
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("666666@g.us");
  });

  it("corrida na carga fria: leitura velha que termina depois de salvar não sobrescreve", async () => {
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "222222@g.us" } } });
    const { db } = await import("@/lib/db");
    const original = db.configuracao.findUnique.bind(db.configuracao);
    let soltar!: () => void;
    const portao = new Promise<void>((r) => (soltar = r));
    // 1ª leitura (a carga fria) lê o valor velho e só devolve depois do save.
    vi.spyOn(db.configuracao, "findUnique").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const velho = await original(args);
      await portao;
      return velho;
    }) as never);
    const carga = carregarConfigTecnica();
    const versao = (await dbT.configuracao.findUniqueOrThrow({ where: { chave: "tecnica" } })).atualizadoEm;
    expect(await salvarConfigTecnica({ grupoJid: "555555@g.us" }, admin, versao, GRUPOS())).toMatchObject({ ok: true });
    soltar();
    await carga;
    expect(grupoJid()).toBe("555555@g.us");
  });

  it("invalidar durante a carga: a carga relê em vez de aplicar o valor velho", async () => {
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "222222@g.us" } } });
    const { db } = await import("@/lib/db");
    const original = db.configuracao.findUnique.bind(db.configuracao);
    let soltar!: () => void;
    const portao = new Promise<void>((r) => (soltar = r));
    vi.spyOn(db.configuracao, "findUnique").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const velho = await original(args);
      await portao;
      return velho;
    }) as never);
    const carga = carregarConfigTecnica();
    await dbT.configuracao.update({ where: { chave: "tecnica" }, data: { valor: { grupoJid: "555555@g.us" } } });
    invalidarConfigTecnica();
    soltar();
    await carga;
    await carregarConfigTecnica();
    expect(grupoJid()).toBe("555555@g.us");
  });

  it("restaurar com versão velha → CONFLITO e não apaga", async () => {
    await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null, GRUPOS());
    expect(await restaurarConfigTecnica(admin, new Date(0))).toEqual({ ok: false, erro: "CONFLITO" });
    expect(await restaurarConfigTecnica(admin, null)).toEqual({ ok: false, erro: "CONFLITO" });
    expect(await dbT.configuracao.count()).toBe(1);
  });

  it("recusa salvar/restaurar deixando o CRM sem grupo (nem config nem env)", async () => {
    delete process.env.GRUPO_JID;
    const r = await salvarConfigTecnica({ limiarConfianca: 0.5 }, admin, null, GRUPOS());
    expect(r).toMatchObject({ ok: false, erro: "DADOS_INVALIDOS", mensagem: expect.stringMatching(/sem grupo/i) });
    expect(await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null, GRUPOS())).toMatchObject({ ok: true });
    const versao = (await dbT.configuracao.findUniqueOrThrow({ where: { chave: "tecnica" } })).atualizadoEm;
    expect(await salvarConfigTecnica({}, admin, versao, GRUPOS())).toMatchObject({ ok: false, mensagem: expect.stringMatching(/sem grupo/i) });
    expect(await restaurarConfigTecnica(admin, versao)).toMatchObject({ ok: false, mensagem: expect.stringMatching(/sem grupo/i) });
    expect(await dbT.configuracao.count()).toBe(1);
  });

  it("GRUPO_JID novo precisa estar entre os grupos da instância", async () => {
    const e = evo(["222222@g.us"]);
    expect(await salvarConfigTecnica({ grupoJid: "999999@g.us" }, admin, null, e)).toMatchObject({
      ok: false,
      erro: "DADOS_INVALIDOS",
      mensagem: expect.stringMatching(/não está entre os grupos/),
    });
    expect(await salvarConfigTecnica({ grupoJid: "222222@g.us" }, admin, null, e)).toMatchObject({ ok: true });
    // Salvar de novo sem trocar o grupo não consulta a Evolution.
    e.listarGrupos.mockClear();
    const versao = (await dbT.configuracao.findUniqueOrThrow({ where: { chave: "tecnica" } })).atualizadoEm;
    expect(await salvarConfigTecnica({ grupoJid: "222222@g.us", limiarConfianca: 0.6 }, admin, versao, e)).toMatchObject({ ok: true });
    expect(e.listarGrupos).not.toHaveBeenCalled();
  });

  it("Evolution fora: só salva grupo novo com confirmação explícita", async () => {
    const fora = { listarGrupos: vi.fn(async () => Promise.reject(new ErroEvolutionAdmin("Evolution group/fetchAllGroups: falha de rede"))) };
    expect(await salvarConfigTecnica({ grupoJid: "999999@g.us" }, admin, null, fora)).toMatchObject({
      ok: false,
      erro: "EVOLUTION_INDISPONIVEL",
      mensagem: expect.stringMatching(/falha de rede/),
    });
    expect(await dbT.configuracao.count()).toBe(0);
    expect(await salvarConfigTecnica({ grupoJid: "999999@g.us" }, admin, null, { ...fora, confirmarSemEvolution: true })).toMatchObject({ ok: true });
    expect(grupoJid()).toBe("999999@g.us");
  });

  it("config salva com combinação inválida (env mudou): carga ignora, vale o env, log só com a chave", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await dbT.configuracao.create({ data: { chave: "tecnica", valor: { grupoJid: "222222@g.us", modeloExtracao: "gpt-segredo-x" } } });
    process.env.LLM_PROVEDOR = "anthropic";
    expect(await carregarConfigTecnica()).toEqual({ ok: true });
    expect(grupoJid()).toBe("111111@g.us");
    const linhas = erro.mock.calls.join(" ");
    expect(linhas).toMatch(/config\.tecnica\.carregar\] ref=\w+ .*tecnica/);
    expect(linhas).not.toContain("gpt-segredo-x");
    expect(linhas).not.toContain("222222");
  });
});
