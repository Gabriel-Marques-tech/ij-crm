// @vitest-environment node
/**
 * GAB-105: cadastro único. Gestão → Usuários cria conta + membro do G&G + ocupação numa
 * transação; a edição atribui e encerra posição. Serviços de verdade, banco de teste.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { adicionarPosicaoAoUsuario, cadastrarPessoa, encerrarOcupacaoDoUsuario, ocupacoesPorConta, opcoesDePosicao, type OpcaoPosicao } from "./cadastro";

const db = dbTeste();
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function semear({ comGG = true } = {}) {
  await db.areaOrg.createMany({
    data: [
      { id: "gg", nome: "Gente & Gestão", ehGG: comGG },
      { id: "rh", nome: "RH", tipo: "FRENTE", superiorId: "gg" },
      { id: "proj", nome: "Projetos", ladoCrm: "PROJETOS" },
      { id: "vend", nome: "Vendas", ladoCrm: "VENDAS" },
    ],
  });
  await db.cargoOrg.createMany({
    data: [
      { id: "dir", nome: "Diretor", categoria: "DIRETORIA" },
      { id: "ana", nome: "Analista", categoria: "MEMBRO" },
      { id: "pm", nome: "PM", categoria: "LIDERANCA", ehGp: true },
      { id: "gpv", nome: "GP", categoria: "LIDERANCA", ehGp: true },
      { id: "mem", nome: "Membro regular", categoria: "MEMBRO" },
    ],
  });
  await db.posicao.createMany({
    data: [
      { id: "p_agg", nome: "Analista de G&G", areaId: "gg", cargoId: "ana" },
      { id: "p_arh", nome: "Analista de RH", areaId: "rh", cargoId: "ana" },
      { id: "p_dproj", nome: "Diretoria de Projetos", areaId: "proj", cargoId: "dir" },
      { id: "p_pm", nome: "PM", areaId: "proj", cargoId: "pm" },
      { id: "p_mv", nome: "Membro de Vendas", areaId: "vend", cargoId: "mem" },
      { id: "p_gpv", nome: "GP de Vendas", areaId: "vend", cargoId: "gpv" },
      { id: "p_velha", nome: "Antiga", areaId: "vend", cargoId: "mem", ativo: false },
    ],
  });
  const usuario = (nome: string, papel: Papel) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel }, select: { id: true, nome: true, papel: true } });
  return { admin: await usuario("Alice", "ADMIN"), gestor: await usuario("Julia", "GESTOR") };
}

beforeEach(async () => {
  await limparBanco(["historico_org", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org", "sessao", "usuario"]);
});

async function opcao(id: string): Promise<OpcaoPosicao> {
  const o = opcoesDePosicao(await carregarBase()).grupos.flatMap((g) => g.opcoes).find((x) => x.id === id);
  if (!o) throw new Error(`sem opção ${id}`);
  return o;
}
const conta = (email: string) => db.usuario.findUnique({ where: { email }, select: { id: true, papel: true, area: true, cargos: true } });
const membroDe = (usuarioId: string) => db.membro.findUnique({ where: { usuarioId }, include: { ocupacoes: true, vinculos: true } });

describe("cadastrarPessoa com posição", () => {
  it("G&G: a pessoa vira editora de G&G (ehEditorGG), com membro, período e ocupação principal desde hoje", async () => {
    const { gestor } = await semear();
    const o = await opcao("p_agg");
    expect(o).toMatchObject({ rotulo: "Gente & Gestão · Analista", ehGG: true, sugestao: { papel: "VISUALIZADOR", area: null, cargos: [] } });
    const r = await cadastrarPessoa({ nome: "Gabi", email: "Gabi@IJ.test", ...o.sugestao, posicaoId: o.id }, gestor);
    expect(r).toMatchObject({ ok: true, membro: "criado" });
    const u = await conta("gabi@ij.test");
    expect(u).toMatchObject({ papel: "VISUALIZADOR", area: null, cargos: [] });
    const m = await membroDe(u!.id);
    expect(m).toMatchObject({ nome: "Gabi", email: "gabi@ij.test", status: "ATIVO" });
    expect(m!.vinculos).toHaveLength(1);
    expect(m!.ocupacoes).toHaveLength(1);
    expect(m!.ocupacoes[0]).toMatchObject({ posicaoId: "p_agg", principal: true, fim: null });
    expect(m!.ocupacoes[0].inicio!.toISOString().slice(0, 10)).toBe(HOJE);
    expect(await ehEditorGG(u!)).toBe(true);
  });

  it("frente de G&G também dá a caneta; o grupo diz de que área é a frente", async () => {
    const { gestor } = await semear();
    const { grupos } = opcoesDePosicao(await carregarBase());
    expect(grupos.find((g) => g.opcoes.some((x) => x.id === "p_arh"))?.rotulo).toBe("RH · frente de Gente & Gestão");
    const o = await opcao("p_arh");
    await cadastrarPessoa({ nome: "Rui", email: "rui@ij.test", ...o.sugestao, posicaoId: o.id }, gestor);
    expect(await ehEditorGG((await conta("rui@ij.test"))!)).toBe(true);
  });

  it("Projetos (PM): papel PROJETOS e cargo PM", async () => {
    const { gestor } = await semear();
    const o = await opcao("p_pm");
    expect(o).toMatchObject({ rotulo: "Projetos · PM", sugestao: { papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] } });
    expect(await cadastrarPessoa({ nome: "Paula", email: "paula@ij.test", ...o.sugestao, posicaoId: o.id }, gestor)).toMatchObject({ ok: true });
    const u = await conta("paula@ij.test");
    expect(u).toMatchObject({ papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] });
    expect(await ehEditorGG(u!)).toBe(false);
  });

  it("Vendas: membro vira VENDEDOR sem cargo; GP de vendas vira VENDEDOR com GP", async () => {
    const { admin } = await semear();
    const mv = await opcao("p_mv");
    const gp = await opcao("p_gpv");
    expect(mv.sugestao).toEqual({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    expect(gp.sugestao).toEqual({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] });
    await cadastrarPessoa({ nome: "Vini", email: "vini@ij.test", ...mv.sugestao, posicaoId: mv.id }, admin);
    await cadastrarPessoa({ nome: "Gil", email: "gil@ij.test", ...gp.sugestao, posicaoId: gp.id }, admin);
    expect(await conta("vini@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    expect(await conta("gil@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] });
  });

  it("membro existente com o mesmo e-mail (outra caixa) é ligado, sem duplicar; a nova posição vira a principal", async () => {
    const { gestor } = await semear();
    const m = await db.membro.create({ data: { nome: "Ana Antiga", email: "Ana@IJ.test", status: "ATIVO" } });
    await db.ocupacao.create({ data: { membroId: m.id, posicaoId: "p_mv", principal: true } });
    const o = await opcao("p_pm");
    expect(await cadastrarPessoa({ nome: "Ana", email: "ana@ij.test", ...o.sugestao, posicaoId: o.id }, gestor)).toMatchObject({ ok: true, membroId: m.id, membro: "ligado" });
    expect(await db.membro.count()).toBe(1);
    const u = await conta("ana@ij.test");
    const ligado = await membroDe(u!.id);
    expect(ligado!.id).toBe(m.id);
    expect(ligado!.ocupacoes.map((x) => [x.posicaoId, x.principal]).sort()).toEqual([
      ["p_mv", false],
      ["p_pm", true],
    ]);
  });

  it("e-mail parecido não liga (igualdade exata, `_` não é curinga)", async () => {
    const { gestor } = await semear();
    await db.membro.create({ data: { nome: "Outra", email: "ana_x@ij.test", status: "ATIVO" } });
    expect(await cadastrarPessoa({ nome: "Ana", email: "anaxx@ij.test", papel: "VISUALIZADOR" }, gestor)).toMatchObject({ ok: true, membro: "criado" });
    expect(await db.membro.count()).toBe(2);
  });

  it("membro com o e-mail ligado a outra conta: recusa e não cria nada", async () => {
    const { gestor, admin } = await semear();
    await db.membro.create({ data: { nome: "Ana", email: "ana@ij.test", status: "ATIVO", usuarioId: admin.id } });
    const o = await opcao("p_pm");
    expect(await cadastrarPessoa({ nome: "Ana", email: "ana@ij.test", ...o.sugestao, posicaoId: o.id }, gestor)).toEqual({ ok: false, erro: "MEMBRO_DE_OUTRA_CONTA" });
    expect(await conta("ana@ij.test")).toBeNull();
    expect(await db.ocupacao.count()).toBe(0);
  });

  it("falha no meio (posição desativada depois de criar conta e membro) desfaz tudo", async () => {
    const { gestor } = await semear();
    expect(await cadastrarPessoa({ nome: "Zeca", email: "zeca@ij.test", papel: "VENDEDOR", posicaoId: "p_velha" }, gestor)).toEqual({ ok: false, erro: "NAO_ENCONTRADO" });
    expect(await conta("zeca@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(0);
    expect(await db.vinculoIj.count()).toBe(0);
    expect(await db.historicoOrg.count()).toBe(0);
  });

  it("email já em uso na conta: recusa sem tocar no G&G", async () => {
    const { gestor } = await semear();
    expect(await cadastrarPessoa({ nome: "J", email: "julia@ij.test", papel: "VENDEDOR", posicaoId: "p_mv" }, gestor)).toEqual({ ok: false, erro: "EMAIL_EM_USO" });
    expect(await db.membro.count()).toBe(0);
  });

  it("diretoria deriva GESTOR (+ Diretor em Projetos): gestor pode; ADMIN forjado por gestor é recusado e nada é criado", async () => {
    const { gestor, admin } = await semear();
    const o = await opcao("p_dproj");
    expect(o.sugestao).toEqual({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });
    expect(await cadastrarPessoa({ nome: "Dora", email: "dora@ij.test", ...o.sugestao, posicaoId: o.id }, gestor)).toMatchObject({ ok: true });
    expect(await conta("dora@ij.test")).toMatchObject({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });

    expect(await cadastrarPessoa({ nome: "Ari", email: "ari@ij.test", papel: "ADMIN", posicaoId: o.id }, gestor)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await conta("ari@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(1);
    // Quem não é da gestão não cadastra, nem com posição.
    const v = await db.usuario.create({ data: { nome: "Vera", email: "vera@ij.test", papel: "VENDEDOR" } });
    expect(await cadastrarPessoa({ nome: "Bia", email: "bia@ij.test", papel: "VISUALIZADOR", posicaoId: "p_agg" }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    // Admin cria admin.
    expect(await cadastrarPessoa({ nome: "Ari", email: "ari@ij.test", papel: "ADMIN", posicaoId: o.id }, admin)).toMatchObject({ ok: true });
  });

  it("sem posição: cria a conta e o membro, sem ocupação", async () => {
    const { gestor } = await semear();
    expect(await cadastrarPessoa({ nome: "Nina", email: "nina@ij.test", papel: "VENDEDOR" }, gestor)).toMatchObject({ ok: true, membro: "criado" });
    const u = await conta("nina@ij.test");
    expect((await membroDe(u!.id))!.ocupacoes).toEqual([]);
  });
});

describe("pré-requisito do G&G", () => {
  it("sem área marcada ehGG: temAreaGG falso e a posição ainda parece de G&G (para o aviso)", async () => {
    await semear({ comGG: false });
    const { temAreaGG, grupos } = opcoesDePosicao(await carregarBase());
    expect(temAreaGG).toBe(false);
    const o = grupos.flatMap((g) => g.opcoes).find((x) => x.id === "p_agg")!;
    expect(o).toMatchObject({ ehGG: false, pareceGG: true });
    expect(grupos.flatMap((g) => g.opcoes).find((x) => x.id === "p_pm")!.pareceGG).toBe(false);
  });
});

describe("edição: adicionar e encerrar posição", () => {
  it("conta sem membro ganha membro e posição; encerrar fecha hoje e tira a caneta do G&G", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Edu", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor)).toEqual({ ok: true });
    expect(await ehEditorGG(u)).toBe(true);
    const ocs = ocupacoesPorConta(await carregarBase())[u.id];
    expect(ocs).toEqual([expect.objectContaining({ rotulo: "Gente & Gestão · Analista", principal: true, inicio: HOJE })]);
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor)).toEqual({ ok: false, erro: "JA_OCUPA" });
    expect(await encerrarOcupacaoDoUsuario(u.id, ocs[0].ocupacaoId, gestor)).toEqual({ ok: true });
    const o = await db.ocupacao.findUniqueOrThrow({ where: { id: ocs[0].ocupacaoId } });
    expect(o.fim!.toISOString().slice(0, 10)).toBe(HOJE);
    expect(await ehEditorGG(u)).toBe(false);
    expect(ocupacoesPorConta(await carregarBase())[u.id]).toEqual([]);
  });

  it("segunda posição não vira principal; liga membro existente pelo e-mail", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Lia", email: "lia@ij.test", papel: "PROJETOS", area: "PROJETOS" } });
    const m = await db.membro.create({ data: { nome: "Lia", email: "LIA@ij.test", status: "ATIVO" } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_pm", gestor)).toEqual({ ok: true });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor)).toEqual({ ok: true });
    expect((await db.membro.findUniqueOrThrow({ where: { id: m.id } })).usuarioId).toBe(u.id);
    const ocs = await db.ocupacao.findMany({ where: { membroId: m.id }, orderBy: { criadoEm: "asc" } });
    expect(ocs.map((o) => [o.posicaoId, o.principal])).toEqual([
      ["p_pm", true],
      ["p_agg", false],
    ]);
  });

  it("régua da Gestão: gestor não mexe em admin nem na própria posição; ocupação de outra pessoa não é encerrada por aqui", async () => {
    const { gestor, admin } = await semear();
    expect(await adicionarPosicaoAoUsuario(admin.id, "p_agg", gestor)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await adicionarPosicaoAoUsuario(gestor.id, "p_agg", gestor)).toEqual({ ok: false, erro: "NAO_PODE_ALTERAR_A_SI" });
    expect(await db.membro.count()).toBe(0);
    // Admin pode na própria conta (como no lado/cargo).
    expect(await adicionarPosicaoAoUsuario(admin.id, "p_agg", admin)).toEqual({ ok: true });

    const a = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test", papel: "VENDEDOR" } });
    const b = await db.usuario.create({ data: { nome: "Bia", email: "bia@ij.test", papel: "VENDEDOR" } });
    await adicionarPosicaoAoUsuario(a.id, "p_mv", gestor);
    await adicionarPosicaoAoUsuario(b.id, "p_mv", gestor);
    const daBia = ocupacoesPorConta(await carregarBase())[b.id][0];
    expect(await encerrarOcupacaoDoUsuario(a.id, daBia.ocupacaoId, gestor)).toEqual({ ok: false, erro: "NAO_ENCONTRADO" });
    expect((await db.ocupacao.findUniqueOrThrow({ where: { id: daBia.ocupacaoId } })).fim).toBeNull();
    // Vendedor (fora da gestão) não atribui.
    expect(await adicionarPosicaoAoUsuario(b.id, "p_agg", a)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
  });
});
