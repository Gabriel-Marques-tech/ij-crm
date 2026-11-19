// @vitest-environment node
/**
 * GAB-105: cadastro único. Gestão → Usuários cria conta + membro do G&G + ocupação numa
 * transação; a edição atribui e encerra posição. Serviços de verdade, banco de teste.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { adicionarPosicaoAoUsuario, cadastrarPessoa, encerrarOcupacaoDoUsuario, ocupacoesPorConta, opcoesDePosicao, traduzir, type OpcaoPosicao } from "./cadastro";

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

const todas = (areas: ReturnType<typeof opcoesDePosicao>["areas"]) => areas.flatMap((a) => [...a.posicoes, ...a.frentes.flatMap((f) => f.posicoes)]);
async function opcao(id: string): Promise<OpcaoPosicao> {
  const o = todas(opcoesDePosicao(await carregarBase()).areas).find((x) => x.id === id);
  if (!o) throw new Error(`sem opção ${id}`);
  return o;
}
const conta = (email: string) => db.usuario.findUnique({ where: { email }, select: { id: true, papel: true, area: true, cargos: true, areaEntrada: true } });
const membroDe = (usuarioId: string) => db.membro.findUnique({ where: { usuarioId }, include: { ocupacoes: true, vinculos: true } });

describe("cadastrarPessoa com posição", () => {
  it("G&G: a pessoa vira editora de G&G (ehEditorGG), com membro, período e ocupação principal desde hoje", async () => {
    const { gestor } = await semear();
    const o = await opcao("p_agg");
    expect(o).toMatchObject({ rotulo: "Gente & Gestão · Analista", ehGG: true, sugestao: { papel: "VISUALIZADOR", area: null, cargos: [] } });
    const r = await cadastrarPessoa({ nome: "Gabi", email: "Gabi@IJ.test", posicaoId: o.id }, gestor);
    expect(r).toMatchObject({ ok: true, fichaLigada: null });
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

  it("cascata: só áreas de topo, com as frentes dentro; frente de G&G também dá a caneta", async () => {
    const { gestor } = await semear();
    const { areas } = opcoesDePosicao(await carregarBase());
    expect(areas.map((a) => [a.nome, a.posicoes.map((p) => p.cargo), a.frentes.map((f) => [f.nome, f.posicoes.map((p) => p.cargo)])])).toEqual([
      ["Gente & Gestão", ["Analista"], [["RH", ["Analista"]]]],
      ["Projetos", ["Diretor", "PM"], []],
      ["Vendas", ["GP", "Membro regular"], []],
    ]);
    const o = await opcao("p_arh");
    await cadastrarPessoa({ nome: "Rui", email: "rui@ij.test", posicaoId: o.id }, gestor);
    expect(await ehEditorGG((await conta("rui@ij.test"))!)).toBe(true);
  });

  it("Projetos (PM): papel PROJETOS e cargo PM", async () => {
    const { gestor } = await semear();
    const o = await opcao("p_pm");
    expect(o).toMatchObject({ rotulo: "Projetos · PM", sugestao: { papel: "PROJETOS", area: "PROJETOS", cargos: ["PM"] } });
    expect(await cadastrarPessoa({ nome: "Paula", email: "paula@ij.test", posicaoId: o.id }, gestor)).toMatchObject({ ok: true });
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
    await cadastrarPessoa({ nome: "Vini", email: "vini@ij.test", posicaoId: mv.id }, admin);
    await cadastrarPessoa({ nome: "Gil", email: "gil@ij.test", posicaoId: gp.id }, admin);
    expect(await conta("vini@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    expect(await conta("gil@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"] });
  });

  it("membro existente com o mesmo e-mail (outra caixa) é ligado, sem duplicar; a nova posição vira a principal, com histórico; o resultado mostra a ficha", async () => {
    const { gestor } = await semear();
    const m = await db.membro.create({ data: { nome: "Ana Antiga", email: "Ana@IJ.test", status: "ATIVO" } });
    await db.ocupacao.create({ data: { membroId: m.id, posicaoId: "p_mv", principal: true } });
    const o = await opcao("p_pm");
    const r = await cadastrarPessoa({ nome: "Ana", email: "ana@ij.test", posicaoId: o.id }, gestor);
    expect(r).toMatchObject({ ok: true, membroId: m.id });
    expect(r.ok && r.fichaLigada).toEqual({ nome: "Ana Antiga", posicoes: expect.arrayContaining(["Vendas · Membro regular", "Projetos · PM"]) });
    expect((await db.historicoOrg.findMany({ where: { membroId: m.id } })).map((h) => h.evento)).toContain("Posição principal: PM (antes: Membro de Vendas)");
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
    expect(await cadastrarPessoa({ nome: "Ana", email: "anaxx@ij.test", posicaoId: "p_mv" }, gestor)).toMatchObject({ ok: true, fichaLigada: null });
    expect(await db.membro.count()).toBe(2);
  });

  it("membro com o e-mail ligado a outra conta: recusa e não cria nada", async () => {
    const { gestor, admin } = await semear();
    await db.membro.create({ data: { nome: "Ana", email: "ana@ij.test", status: "ATIVO", usuarioId: admin.id } });
    const o = await opcao("p_pm");
    expect(await cadastrarPessoa({ nome: "Ana", email: "ana@ij.test", posicaoId: o.id }, gestor)).toEqual({ ok: false, erro: "MEMBRO_DE_OUTRA_CONTA" });
    expect(await conta("ana@ij.test")).toBeNull();
    expect(await db.ocupacao.count()).toBe(0);
  });

  it("falha no meio (posição desativada depois de criar conta e membro) desfaz tudo", async () => {
    const { gestor } = await semear();
    expect(await cadastrarPessoa({ nome: "Zeca", email: "zeca@ij.test", posicaoId: "p_velha" }, gestor)).toEqual({ ok: false, erro: "NAO_ENCONTRADO" });
    expect(await conta("zeca@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(0);
    expect(await db.vinculoIj.count()).toBe(0);
    expect(await db.historicoOrg.count()).toBe(0);
  });

  it("email já em uso na conta: recusa sem tocar no G&G", async () => {
    const { gestor } = await semear();
    expect(await cadastrarPessoa({ nome: "J", email: "julia@ij.test", posicaoId: "p_mv" }, gestor)).toEqual({ ok: false, erro: "EMAIL_EM_USO" });
    expect(await db.membro.count()).toBe(0);
  });

  it("diretoria deriva GESTOR (+ Diretor em Projetos): gestor pode; ADMIN forjado por gestor é recusado e nada é criado", async () => {
    const { gestor, admin } = await semear();
    const o = await opcao("p_dproj");
    expect(o.sugestao).toEqual({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });
    expect(await cadastrarPessoa({ nome: "Dora", email: "dora@ij.test", posicaoId: o.id }, gestor)).toMatchObject({ ok: true });
    expect(await conta("dora@ij.test")).toMatchObject({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });

    expect(await cadastrarPessoa({ nome: "Ari", email: "ari@ij.test", administrador: true, posicaoId: o.id }, gestor)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await conta("ari@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(1);
    // Quem não é da gestão não cadastra, nem com posição.
    const v = await db.usuario.create({ data: { nome: "Vera", email: "vera@ij.test", papel: "VENDEDOR" } });
    expect(await cadastrarPessoa({ nome: "Bia", email: "bia@ij.test", posicaoId: "p_agg" }, v)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    // Admin cria admin.
    expect(await cadastrarPessoa({ nome: "Ari", email: "ari@ij.test", administrador: true, posicaoId: o.id }, admin)).toMatchObject({ ok: true });
    expect(await conta("ari@ij.test")).toMatchObject({ papel: "ADMIN", area: "PROJETOS", cargos: ["DIRETOR"] });
  });

  it("sem posição: conta Visualizador (entra no Geral) e o membro SEMPRE existe; liga o do mesmo e-mail", async () => {
    const { gestor } = await semear();
    const solto = await db.membro.create({ data: { nome: "Nina", email: "nina@ij.test", status: "ATIVO" } });
    expect(await cadastrarPessoa({ nome: "Nina", email: "nina@ij.test" }, gestor)).toMatchObject({ ok: true, membroId: solto.id, fichaLigada: { nome: "Nina", posicoes: [] } });
    const u = await conta("nina@ij.test");
    expect(u).toMatchObject({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
    expect((await membroDe(u!.id))!.id).toBe(solto.id);
    expect(await db.membro.count()).toBe(1);
    // Sem ficha nenhuma: membro novo, ATIVO, com período aberto e sem ocupação.
    const r = await cadastrarPessoa({ nome: "Otto", email: "otto@ij.test" }, gestor);
    expect(r).toMatchObject({ ok: true, fichaLigada: null });
    const m = await membroDe((await conta("otto@ij.test"))!.id);
    expect(m).toMatchObject({ nome: "Otto", email: "otto@ij.test", status: "ATIVO" });
    expect(m!.vinculos).toHaveLength(1);
    expect(m!.ocupacoes).toHaveLength(0);
  });

  it("membro INATIVO ligado pelo e-mail faz reingresso na mesma transação (novo período, ATIVO, histórico)", async () => {
    const { gestor } = await semear();
    const m = await db.membro.create({ data: { nome: "Rita", email: "rita@ij.test", status: "INATIVO" } });
    await db.vinculoIj.create({ data: { membroId: m.id, entrada: new Date("2025-02-01"), saida: new Date("2025-12-01") } });
    const o = await opcao("p_agg");
    expect(await cadastrarPessoa({ nome: "Rita", email: "rita@ij.test", posicaoId: o.id }, gestor)).toMatchObject({ ok: true, membroId: m.id });
    const r = await db.membro.findUniqueOrThrow({ where: { id: m.id }, include: { vinculos: { orderBy: { entrada: "asc" } } } });
    expect(r.status).toBe("ATIVO");
    expect(r.vinculos.map((v) => [v.entrada?.toISOString().slice(0, 10), v.saida?.toISOString().slice(0, 10) ?? null])).toEqual([
      ["2025-02-01", "2025-12-01"],
      [HOJE, null],
    ]);
    expect((await db.historicoOrg.findMany({ where: { membroId: m.id } })).map((h) => h.evento)).toContain("Reingresso na IJ (cadastro na Gestão)");
    expect(await ehEditorGG((await conta("rita@ij.test"))!)).toBe(true);
  });

  it("homônimo sem e-mail e sem conta: recusa até confirmar; ligar grava o e-mail; outra pessoa cria novo", async () => {
    const { gestor } = await semear();
    const ana = await db.membro.create({ data: { nome: "Ana Souza", status: "ATIVO" } });
    const o = await opcao("p_pm");
    const dados = { nome: "ana  souza", email: "ana@ij.test", ...o.sugestao, posicaoId: o.id };
    expect(await cadastrarPessoa({ ...dados, nome: "Ana Souza" }, gestor)).toEqual({ ok: false, erro: "MEMBRO_MESMO_NOME", homonimos: [{ id: ana.id, nome: "Ana Souza" }] });
    expect(await conta("ana@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(1);

    const r = await cadastrarPessoa({ ...dados, nome: "Ana Souza" }, gestor, { ligarMembroId: ana.id });
    expect(r).toMatchObject({ ok: true, membroId: ana.id, fichaLigada: { nome: "Ana Souza", posicoes: ["Projetos · PM"] } });
    const m = await db.membro.findUniqueOrThrow({ where: { id: ana.id } });
    expect(m).toMatchObject({ email: "ana@ij.test", usuarioId: (await conta("ana@ij.test"))!.id });
    expect((await db.historicoOrg.findMany({ where: { membroId: ana.id } })).map((h) => h.evento)).toContain("Conta do CRM ligada e e-mail gravado pelo cadastro na Gestão (ana@ij.test)");

    // Outro homônimo, e quem cadastra diz que é outra pessoa: membro novo.
    await db.membro.create({ data: { nome: "Bia Lima", status: "ATIVO" } });
    expect(await cadastrarPessoa({ nome: "Bia Lima", email: "bia@ij.test", posicaoId: "p_mv" }, gestor)).toMatchObject({ ok: false, erro: "MEMBRO_MESMO_NOME" });
    expect(await cadastrarPessoa({ nome: "Bia Lima", email: "bia@ij.test", posicaoId: "p_mv" }, gestor, { criarMembroNovo: true })).toMatchObject({ ok: true, fichaLigada: null });
    expect(await db.membro.count({ where: { nome: "Bia Lima" } })).toBe(2);
    // Ligar a um membro que já tem e-mail ou conta não passa.
    expect(await cadastrarPessoa({ nome: "Caio", email: "caio@ij.test", posicaoId: "p_mv" }, gestor, { ligarMembroId: ana.id })).toMatchObject({ ok: false, erro: "NAO_ENCONTRADO" });
    expect(await conta("caio@ij.test")).toBeNull();
  });

  it("ligarMembroId forjado: a ficha de outra pessoa (sem e-mail e sem conta, outro nome) não é ligada", async () => {
    const { gestor } = await semear();
    const carlos = await db.membro.create({ data: { nome: "Carlos Diretor", status: "ATIVO" } });
    await db.membro.create({ data: { nome: "Zé Lima", status: "ATIVO" } });
    expect(await cadastrarPessoa({ nome: "Zé Lima", email: "ze@ij.test", posicaoId: "p_mv" }, gestor, { ligarMembroId: carlos.id })).toMatchObject({ ok: false, erro: "NAO_ENCONTRADO" });
    // Sem homônimo nenhum, o id forjado também não passa (não vira "criar novo" escondido).
    expect(await cadastrarPessoa({ nome: "Bruna", email: "bruna@ij.test", posicaoId: "p_mv" }, gestor, { ligarMembroId: carlos.id })).toMatchObject({ ok: false, erro: "NAO_ENCONTRADO" });
    const u = await db.usuario.create({ data: { nome: "Edu", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor, { ligarMembroId: carlos.id })).toMatchObject({ ok: false, erro: "NAO_ENCONTRADO" });
    expect(await db.membro.findUniqueOrThrow({ where: { id: carlos.id } })).toMatchObject({ usuarioId: null, email: null });
    expect(await db.usuario.count({ where: { email: { in: ["ze@ij.test", "bruna@ij.test"] } } })).toBe(0);
  });

  it("homônimo: espaços internos não escondem; com mais de um, devolve todos para a tela escolher", async () => {
    const { gestor } = await semear();
    const a1 = await db.membro.create({ data: { nome: "Ana  Souza", status: "ATIVO" } });
    const a2 = await db.membro.create({ data: { nome: "ana souza", status: "INATIVO" } });
    const r = await cadastrarPessoa({ nome: "Ána Souza", email: "ana@ij.test", posicaoId: "p_mv" }, gestor);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.homonimos?.map((h) => h.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(await cadastrarPessoa({ nome: "Ána Souza", email: "ana@ij.test", posicaoId: "p_mv" }, gestor, { ligarMembroId: a2.id })).toMatchObject({ ok: true, membroId: a2.id });
  });

  it("reingresso pela Gestão encerra na data da saída as ocupações que ficaram abertas antes dela, com histórico", async () => {
    const { gestor } = await semear();
    const m = await db.membro.create({ data: { nome: "Rita", email: "rita@ij.test", status: "INATIVO" } });
    await db.vinculoIj.create({ data: { membroId: m.id, entrada: new Date("2025-02-01"), saida: new Date("2025-12-01") } });
    const presa = await db.ocupacao.create({ data: { membroId: m.id, posicaoId: "p_mv", inicio: new Date("2025-03-01"), principal: true } });
    expect(await cadastrarPessoa({ nome: "Rita", email: "rita@ij.test", posicaoId: "p_pm" }, gestor)).toMatchObject({ ok: true });
    const o = await db.ocupacao.findUniqueOrThrow({ where: { id: presa.id } });
    expect(o.fim?.toISOString().slice(0, 10)).toBe("2025-12-01");
    expect(o.principal).toBe(false);
    expect((await db.historicoOrg.findMany({ where: { membroId: m.id } })).map((h) => h.evento)).toContain("Vínculo encerrado na saída da IJ: Membro de Vendas");
    expect(ocupacoesPorConta(await carregarBase())[(await conta("rita@ij.test"))!.id].map((x) => x.rotulo)).toEqual(["Projetos · PM"]);
  });

  it("P2002 real do índice membro_email_unico vira recusa clara", async () => {
    await semear();
    await db.membro.create({ data: { nome: "Ana", email: "ana@ij.test" } });
    const erro = await db.membro.create({ data: { nome: "Outra", email: "ANA@ij.test" } }).catch((e: unknown) => e);
    expect(traduzir(erro)).toEqual({ ok: false, erro: "MEMBRO_EMAIL_EM_USO" });
    // P2002 de outra tabela não é traduzido como membro.
    const outro = await db.usuario.create({ data: { nome: "J2", email: "julia@ij.test" } }).catch((e: unknown) => e);
    expect(() => traduzir(outro)).toThrow();
  });

  it("frentes de mesmo nome em ramos diferentes mostram o caminho", async () => {
    await semear();
    // O banco barra nome igual (lower/trim), mas não acento: "Seleção" e "Selecao" convivem.
    await db.areaOrg.createMany({
      data: [
        { id: "sel1", nome: "Seleção", tipo: "FRENTE", superiorId: "gg" },
        { id: "pes", nome: "Pessoas", tipo: "FRENTE", superiorId: "gg" },
        { id: "sel2", nome: "Selecao", tipo: "FRENTE", superiorId: "pes" },
      ],
    });
    await db.posicao.createMany({
      data: [
        { id: "p_s1", nome: "Analista Sel 1", areaId: "sel1", cargoId: "ana" },
        { id: "p_s2", nome: "Analista Sel 2", areaId: "sel2", cargoId: "ana" },
      ],
    });
    const gg = opcoesDePosicao(await carregarBase()).areas.find((a) => a.id === "gg")!;
    expect(gg.frentes.map((f) => f.nome)).toEqual(["Pessoas · Selecao", "RH", "Seleção"]);
  });

  it("posição com área ou cargo desativado não é atribuída", async () => {
    const { gestor } = await semear();
    await db.cargoOrg.update({ where: { id: "gpv" }, data: { ativo: false } });
    expect(await cadastrarPessoa({ nome: "Gil", email: "gil@ij.test", posicaoId: "p_gpv" }, gestor)).toEqual({ ok: false, erro: "NAO_ENCONTRADO" });
    await db.areaOrg.update({ where: { id: "proj" }, data: { ativo: false } });
    expect(await cadastrarPessoa({ nome: "Paula", email: "paula@ij.test", posicaoId: "p_pm" }, gestor)).toEqual({ ok: false, erro: "NAO_ENCONTRADO" });
    expect(await db.usuario.count({ where: { email: { in: ["gil@ij.test", "paula@ij.test"] } } })).toBe(0);
  });
});

describe("pré-requisito do G&G", () => {
  it("sem área marcada ehGG: temAreaGG falso e a posição ainda parece de G&G (para o aviso)", async () => {
    await semear({ comGG: false });
    const { temAreaGG, areas } = opcoesDePosicao(await carregarBase());
    expect(temAreaGG).toBe(false);
    expect(areas.find((a) => a.id === "gg")).toMatchObject({ ehGG: false, pareceGG: true });
    expect(todas(areas).find((x) => x.id === "p_agg")).toMatchObject({ ehGG: false, pareceGG: true });
    expect(areas.find((a) => a.id === "proj")!.pareceGG).toBe(false);
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

  it("conta sem membro e homônimo sem e-mail: pergunta; confirmado, liga a ele", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Edu Lima", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    const edu = await db.membro.create({ data: { nome: "Edu Lima", status: "ATIVO" } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor)).toEqual({ ok: false, erro: "MEMBRO_MESMO_NOME", homonimos: [{ id: edu.id, nome: "Edu Lima" }] });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor, { ligarMembroId: edu.id })).toEqual({ ok: true });
    expect(await db.membro.findUniqueOrThrow({ where: { id: edu.id } })).toMatchObject({ usuarioId: u.id, email: "edu@ij.test" });
  });

  it("conta já ligada a membro INATIVO: adicionar posição faz o reingresso", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Ivo", email: "ivo@ij.test", papel: "VISUALIZADOR" } });
    const m = await db.membro.create({ data: { nome: "Ivo", email: "ivo@ij.test", status: "INATIVO", usuarioId: u.id } });
    await db.vinculoIj.create({ data: { membroId: m.id, entrada: new Date("2025-01-10"), saida: new Date("2025-06-30") } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_agg", gestor)).toEqual({ ok: true });
    const r = await db.membro.findUniqueOrThrow({ where: { id: m.id }, include: { vinculos: true } });
    expect(r.status).toBe("ATIVO");
    expect(r.vinculos.filter((v) => v.saida === null).map((v) => v.entrada?.toISOString().slice(0, 10))).toEqual([HOJE]);
    expect(await ehEditorGG(u)).toBe(true);
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

describe("GAB-107: conta derivada da posição", () => {
  async function semearDiretorias() {
    await db.areaOrg.create({ data: { id: "pres", nome: "Presidência", tipo: "INSTITUCIONAL" } });
    await db.cargoOrg.create({ data: { id: "presidente", nome: "Presidente", categoria: "DIRETORIA" } });
    await db.posicao.createMany({
      data: [
        { id: "p_pres", nome: "Presidência", areaId: "pres", cargoId: "presidente" },
        { id: "p_dvend", nome: "Diretoria de Vendas", areaId: "vend", cargoId: "dir" },
      ],
    });
  }

  it("papel, área, cargos e área de entrada mandados pelo cliente são ignorados: vale a posição", async () => {
    const { gestor } = await semear();
    const forjado = { papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"], areaEntrada: "PROJETOS" } as object;
    expect(await cadastrarPessoa({ nome: "Vini", email: "vini@ij.test", posicaoId: "p_mv", ...forjado }, gestor)).toMatchObject({ ok: true, conta: { papel: "VENDEDOR", area: "VENDAS", cargos: [], areaEntrada: null } });
    expect(await conta("vini@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: [], areaEntrada: null });
  });

  it("presidência = Gestor sem área (vê e edita as duas áreas), entra no Geral; diretoria de Vendas = Gestor de Vendas; diretoria de Projetos = Gestor de Projetos + Diretor", async () => {
    const { gestor } = await semear();
    await semearDiretorias();
    await cadastrarPessoa({ nome: "Pedro", email: "pedro@ij.test", posicaoId: "p_pres" }, gestor);
    expect(await conta("pedro@ij.test")).toMatchObject({ papel: "GESTOR", area: null, cargos: [], areaEntrada: "GERAL" });
    await cadastrarPessoa({ nome: "Vera", email: "vera@ij.test", posicaoId: "p_dvend" }, gestor);
    expect(await conta("vera@ij.test")).toMatchObject({ papel: "GESTOR", area: "VENDAS", cargos: [], areaEntrada: null });
    await cadastrarPessoa({ nome: "Dora", email: "dora@ij.test", posicaoId: "p_dproj" }, gestor);
    expect(await conta("dora@ij.test")).toMatchObject({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"], areaEntrada: null });
  });

  it("diretoria de área sem lado (G&G) não vira gestor das duas áreas: Visualizador (a caneta do G&G vem de ehGG)", async () => {
    const { gestor } = await semear();
    await db.posicao.create({ data: { id: "p_dgg", nome: "Diretoria de G&G", areaId: "gg", cargoId: "dir" } });
    expect((await opcao("p_dgg")).sugestao).toEqual({ papel: "VISUALIZADOR", area: null, cargos: [] });
    await cadastrarPessoa({ nome: "Dani", email: "dani@ij.test", posicaoId: "p_dgg" }, gestor);
    const u = await conta("dani@ij.test");
    expect(u).toMatchObject({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
    expect(await ehEditorGG(u!)).toBe(true);
  });

  it("só G&G (sem lado): Visualizador, entra no Geral", async () => {
    const { gestor } = await semear();
    await cadastrarPessoa({ nome: "Gabi", email: "gabi@ij.test", posicaoId: "p_arh" }, gestor);
    expect(await conta("gabi@ij.test")).toMatchObject({ papel: "VISUALIZADOR", area: null, cargos: [], areaEntrada: "GERAL" });
  });

  it("Administrador: só o admin marca; mantém o lado da posição e entra por ele", async () => {
    const { gestor, admin } = await semear();
    expect(await cadastrarPessoa({ nome: "Gil", email: "gil@ij.test", posicaoId: "p_gpv", administrador: true }, gestor)).toEqual({ ok: false, erro: "PAPEL_NAO_PERMITIDO" });
    expect(await conta("gil@ij.test")).toBeNull();
    expect(await db.membro.count()).toBe(0);
    expect(await cadastrarPessoa({ nome: "Gil", email: "gil@ij.test", posicaoId: "p_gpv", administrador: true }, admin)).toMatchObject({ ok: true });
    expect(await conta("gil@ij.test")).toMatchObject({ papel: "ADMIN", area: "VENDAS", cargos: ["GP"], areaEntrada: "VENDAS" });
  });

  it("conflito: ficha ligada com Vendas e Projetos sem principal entre elas recusa com mensagem própria e não cria nada", async () => {
    const { gestor } = await semear();
    const m = await db.membro.create({ data: { nome: "Caio", email: "caio@ij.test", status: "ATIVO" } });
    await db.ocupacao.createMany({ data: [{ membroId: m.id, posicaoId: "p_mv" }, { membroId: m.id, posicaoId: "p_pm" }] });
    expect(await cadastrarPessoa({ nome: "Caio", email: "caio@ij.test", posicaoId: "p_agg" }, gestor)).toEqual({ ok: false, erro: "CONFLITO_DE_LADO" });
    expect(await conta("caio@ij.test")).toBeNull();
    expect(await db.ocupacao.count({ where: { membroId: m.id } })).toBe(2);
    expect((await db.membro.findUniqueOrThrow({ where: { id: m.id } })).usuarioId).toBeNull();
  });

  it("atribuir/encerrar posição recalcula a conta na mesma transação; encerrar a última deixa a conta como está", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Edu", email: "edu@ij.test", papel: "VISUALIZADOR" } });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_mv", gestor)).toEqual({ ok: true });
    expect(await conta("edu@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    // Segunda posição (não principal): o lado segue a principal (Vendas), e a diretoria de Projetos não dá gestão de Vendas.
    expect(await adicionarPosicaoAoUsuario(u.id, "p_dproj", gestor)).toEqual({ ok: true });
    expect(await conta("edu@ij.test")).toMatchObject({ papel: "VENDEDOR", area: "VENDAS", cargos: [] });
    const ocs = ocupacoesPorConta(await carregarBase())[u.id];
    const vendas = ocs.find((o) => o.rotulo === "Vendas · Membro regular")!;
    expect(await encerrarOcupacaoDoUsuario(u.id, vendas.ocupacaoId, gestor)).toEqual({ ok: true });
    expect(await conta("edu@ij.test")).toMatchObject({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });
    const dir = ocs.find((o) => o.rotulo === "Projetos · Diretor")!;
    expect(await encerrarOcupacaoDoUsuario(u.id, dir.ocupacaoId, gestor)).toEqual({ ok: true });
    expect(await conta("edu@ij.test")).toMatchObject({ papel: "GESTOR", area: "PROJETOS", cargos: ["DIRETOR"] });
  });

  it("atribuir posição que cria conflito de lado é recusado e desfeito", async () => {
    const { gestor } = await semear();
    const u = await db.usuario.create({ data: { nome: "Lia", email: "lia@ij.test", papel: "VISUALIZADOR" } });
    const m = await db.membro.create({ data: { nome: "Lia", email: "lia@ij.test", status: "ATIVO", usuarioId: u.id } });
    await db.ocupacao.createMany({ data: [{ membroId: m.id, posicaoId: "p_agg", principal: true }, { membroId: m.id, posicaoId: "p_mv" }] });
    expect(await adicionarPosicaoAoUsuario(u.id, "p_pm", gestor)).toEqual({ ok: false, erro: "CONFLITO_DE_LADO" });
    expect(await db.ocupacao.count({ where: { membroId: m.id } })).toBe(2);
    expect(await conta("lia@ij.test")).toMatchObject({ papel: "VISUALIZADOR" });
  });

  it("ADMIN nunca é rebaixado pela posição", async () => {
    const { admin } = await semear();
    expect(await adicionarPosicaoAoUsuario(admin.id, "p_mv", admin)).toEqual({ ok: true });
    expect(await conta("alice@ij.test")).toMatchObject({ papel: "ADMIN", area: null, cargos: [] });
    const [oc] = ocupacoesPorConta(await carregarBase())[admin.id];
    expect(await encerrarOcupacaoDoUsuario(admin.id, oc.ocupacaoId, admin)).toEqual({ ok: true });
    expect(await conta("alice@ij.test")).toMatchObject({ papel: "ADMIN" });
  });
});
