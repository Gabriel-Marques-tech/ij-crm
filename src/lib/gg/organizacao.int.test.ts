// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { validarImportacao, vigente } from "./modelo";
import {
  adicionarOcupante,
  carregarBase,
  criarMembro,
  derivadoDe,
  editarPosicao,
  ehEditorGG,
  encerrarOcupacao,
  importarMembros,
  ligarContasPorEmail,
  membroDaContaTx,
  postosDe,
  registrarEntrada,
  registrarSaida,
  retirarPorErro,
  trocarCargo,
  type AtorGG,
} from "./organizacao";

const db = dbTeste();
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function semear() {
  // A migration semeia a estrutura; os testes truncam, então recriamos o mínimo aqui.
  await db.areaOrg.createMany({
    data: [
      { id: "gg", nome: "Gente & Gestão", ehGG: true },
      { id: "rh", nome: "RH", tipo: "FRENTE", superiorId: "gg" },
      { id: "proj", nome: "Projetos", ladoCrm: "PROJETOS" },
      { id: "vend", nome: "Vendas", ladoCrm: "VENDAS" },
    ],
  });
  await db.cargoOrg.createMany({
    data: [
      { id: "dir", nome: "Diretor", categoria: "DIRETORIA" },
      { id: "ger", nome: "Gerente", categoria: "LIDERANCA" },
      { id: "pm", nome: "PM", categoria: "LIDERANCA", ehGp: true },
      { id: "sm", nome: "Scrum Master", categoria: "LIDERANCA" },
      { id: "mem", nome: "Membro regular", categoria: "MEMBRO" },
    ],
  });
  await db.posicao.createMany({
    data: [
      { id: "p_dgg", nome: "Diretoria de G&G", areaId: "gg", cargoId: "dir" },
      { id: "p_grh", nome: "Gerência de RH", areaId: "rh", cargoId: "ger", liderancaId: "p_dgg" },
      { id: "p_dproj", nome: "Diretoria de Projetos", areaId: "proj", cargoId: "dir" },
      { id: "p_pm", nome: "PM", areaId: "proj", cargoId: "pm", liderancaId: "p_dproj" },
      { id: "p_sm", nome: "Scrum Master", areaId: "proj", cargoId: "sm", liderancaId: "p_dproj" },
      { id: "p_mv", nome: "Membro de Vendas", areaId: "vend", cargoId: "mem" },
    ],
  });
  const usuario = async (nome: string, papel: Papel) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
  const admin = await usuario("Alice", "ADMIN");
  const julia = await usuario("Julia", "GESTOR");
  const paulaU = await usuario("Paula", "PROJETOS");
  const ator = (u: { id: string; nome: string; papel: Papel }): AtorGG => ({ id: u.id, nome: u.nome, papel: u.papel });
  return { admin: ator(admin), julia: ator(julia), paula: ator(paulaU), paulaU };
}

beforeEach(async () => {
  await limparBanco(["historico_org", "importacao_membros", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org", "usuario"]);
});

async function novo(nome: string, ator: AtorGG, email: string | null = null) {
  const r = await criarMembro({ nome, email, status: "ATIVO" }, ator);
  if (!r.ok) throw new Error(r.erro);
  return r.id;
}
const ocupacoes = (membroId: string) => db.ocupacao.findMany({ where: { membroId }, orderBy: { criadoEm: "asc" } });

describe("quem edita a área G&G", () => {
  it("admin e quem ocupa hoje posição em G&G (inclusive frente); o resto, não", async () => {
    const { admin, julia, paula } = await semear();
    expect(await ehEditorGG(admin)).toBe(true);
    expect(await ehEditorGG(julia)).toBe(false);
    expect(await criarMembro({ nome: "X", email: null, status: "ATIVO" }, julia)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const m = await novo("Julia", admin, "julia@ij.test"); // liga a conta pelo e-mail
    await adicionarOcupante("p_grh", m, "2026-01-10", admin);
    expect(await ehEditorGG(julia)).toBe(true);
    expect(await ehEditorGG(paula)).toBe(false);
  });
});

describe("organograma (regras do ajustar_ocupacao)", () => {
  it("primeira posição é a principal; não ocupa a mesma posição duas vezes; data futura recusada", async () => {
    const { admin } = await semear();
    const m = await novo("Lucas", admin);
    expect(await adicionarOcupante("p_sm", m, "2026-02-15", admin)).toEqual({ ok: true });
    expect(await adicionarOcupante("p_pm", m, null, admin)).toEqual({ ok: true });
    expect(await adicionarOcupante("p_sm", m, null, admin)).toEqual({ ok: false, erro: "JA_OCUPA" });
    expect(await adicionarOcupante("p_mv", m, "2999-01-01", admin)).toEqual({ ok: false, erro: "DATA_FUTURA" });
    const os = await ocupacoes(m);
    expect(os.map((o) => o.principal)).toEqual([true, false]);
    expect(os[1].inicio).toBeNull(); // início desconhecido não vira hoje
  });

  it("troca real deixa as duas na trajetória; correção tira a antiga e herda o início", async () => {
    const { admin } = await semear();
    const m = await novo("Guto", admin);
    await adicionarOcupante("p_pm", m, "2025-08-01", admin);
    const [o1] = await ocupacoes(m);
    expect(await trocarCargo(o1.id, "p_dproj", "real", "2025-07-01", admin)).toEqual({ ok: false, erro: "DATA_ANTES_DO_INICIO" });
    expect(await trocarCargo(o1.id, "p_dproj", "real", "2026-03-01", admin)).toEqual({ ok: true });
    let os = await ocupacoes(m);
    expect(os.map((o) => [o.posicaoId, o.fim?.toISOString().slice(0, 10) ?? null, o.invalidadoEm === null, o.principal])).toEqual([
      ["p_pm", "2026-03-01", true, false],
      ["p_dproj", null, true, true],
    ]);
    expect(await trocarCargo(os[1].id, "p_sm", "correcao", null, admin)).toEqual({ ok: true });
    os = await ocupacoes(m);
    expect(os[1].invalidadoEm).not.toBeNull();
    expect(os[2]).toMatchObject({ posicaoId: "p_sm", principal: true });
    expect(os[2].inicio?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("retirar por erro exige motivo, some do organograma e fica guardada; encerrar respeita [início, fim)", async () => {
    const { admin } = await semear();
    const m = await novo("Livia", admin);
    await adicionarOcupante("p_sm", m, "2026-03-01", admin);
    await adicionarOcupante("p_mv", m, "2026-03-01", admin);
    const [a, b] = await ocupacoes(m);
    expect(await retirarPorErro(a.id, "  ", admin)).toEqual({ ok: false, erro: "MOTIVO_OBRIGATORIO" });
    expect(await retirarPorErro(a.id, "Cadastrada na área errada", admin)).toEqual({ ok: true });
    expect(await encerrarOcupacao(b.id, HOJE, admin)).toEqual({ ok: true });
    const base = await carregarBase();
    expect(postosDe(base, m)).toEqual([]); // o dia do fim já não conta
    expect((await db.historicoOrg.findMany({ where: { membroId: m } })).map((h) => h.evento)).toContain("Retirada por erro: Scrum Master");
  });

  it("reatribuir a mesma posição não sobrepõe vínculo encerrado (validar_periodo do G&G)", async () => {
    const { admin } = await semear();
    const m = await novo("Nina", admin);
    await adicionarOcupante("p_sm", m, "2026-01-01", admin);
    const [o] = await ocupacoes(m);
    expect(await encerrarOcupacao(o.id, "2026-06-01", admin)).toEqual({ ok: true });
    expect(await adicionarOcupante("p_sm", m, "2026-03-01", admin)).toMatchObject({ ok: false, erro: "JA_OCUPA" });
    expect(await adicionarOcupante("p_sm", m, null, admin)).toMatchObject({ ok: false, erro: "JA_OCUPA" });
    expect(await adicionarOcupante("p_sm", m, "2026-06-01", admin)).toEqual({ ok: true }); // [jan, jun) e [jun, …) só encostam
    expect(await db.ocupacao.count({ where: { membroId: m } })).toBe(2);
  });

  it("liderança: duas edições simultâneas não fecham um ciclo (trava do validar_hierarquia)", async () => {
    const { admin } = await semear();
    const d = (liderancaId: string) => ({ nome: "x", areaId: "proj", cargoId: "sm", liderancaId });
    await db.posicao.createMany({ data: [{ id: "x1", nome: "x", areaId: "proj", cargoId: "sm" }, { id: "x2", nome: "x", areaId: "proj", cargoId: "sm" }] });
    const rs = await Promise.all([editarPosicao("x1", d("x2"), admin), editarPosicao("x2", d("x1"), admin)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, erro: "CICLO" });
  });

  it("saída e reingresso: períodos sem sobreposição; status acompanha", async () => {
    const { admin } = await semear();
    const m = await novo("Rafa", admin);
    await db.vinculoIj.updateMany({ where: { membroId: m }, data: { entrada: new Date("2024-03-01T00:00:00Z") } });
    expect(await registrarSaida(m, "2024-12-15", admin)).toEqual({ ok: true });
    expect(await registrarEntrada(m, "2024-12-01", admin)).toEqual({ ok: false, erro: "DATA_ANTES_DO_INICIO" });
    expect(await registrarEntrada(m, "2025-03-01", admin)).toEqual({ ok: true });
    expect(await db.vinculoIj.count({ where: { membroId: m } })).toBe(2);
    expect((await db.membro.findUniqueOrThrow({ where: { id: m } })).status).toBe("ATIVO");
  });
});

describe("ponte com o CRM", () => {
  it("PM de Projetos sugere PROJETOS + PM; diretor de Projetos sugere GESTOR + Diretor; PO sugere PO; contas ligam pelo e-mail", async () => {
    const { admin, paulaU } = await semear();
    const paula = await db.membro.create({ data: { nome: "Paula", email: "PAULA@ij.test", status: "ATIVO" } });
    expect(await ligarContasPorEmail(admin)).toEqual({ ok: true, ligados: 1 });
    expect((await db.membro.findUniqueOrThrow({ where: { id: paula.id } })).usuarioId).toBe(paulaU.id);
    await adicionarOcupante("p_pm", paula.id, null, admin);
    const g = await novo("Guto", admin);
    await adicionarOcupante("p_dproj", g, null, admin);
    const base = await carregarBase();
    expect(derivadoDe(base, paula.id)).toEqual({ area: "PROJETOS", papel: "PROJETOS", cargos: ["PM"], conflito: null });
    expect(derivadoDe(base, g)).toEqual({ area: "PROJETOS", papel: "GESTOR", cargos: ["DIRETOR"], conflito: null });
    // PO vem do catálogo (id `cargo_po`) ou do nome, como na importação.
    await db.cargoOrg.create({ data: { id: "po_importado", nome: "PO", categoria: "LIDERANCA" } });
    await db.posicao.create({ data: { id: "p_po", nome: "PO", areaId: "proj", cargoId: "po_importado", liderancaId: "p_dproj" } });
    const o = await novo("Olga", admin);
    await adicionarOcupante("p_po", o, null, admin);
    expect(derivadoDe(await carregarBase(), o)).toEqual({ area: "PROJETOS", papel: "PROJETOS", cargos: ["PO"], conflito: null });
  });
});

describe("importação (importar_membros)", () => {
  it("tudo ou nada; área e cargo precisam existir; idempotente pela chave; cria posição que falta", async () => {
    const { admin } = await semear();
    const ruim = validarImportacao([{ nome: "A", area: "Projetos", cargo: "PM" }, { nome: "B", area: "Jurídico", cargo: "PM" }], HOJE);
    expect(await importarMembros(ruim, "00000000-0000-0000-0000-000000000001", admin)).toMatchObject({ ok: false, erro: "IMPORTACAO", detalhe: 'Linha 2: área "Jurídico" não existe.' });
    expect(await db.membro.count()).toBe(0);
    const bom = validarImportacao([{ nome: "Vitor", email: "vitor@ij.test", area: "Projetos", cargo: "PM", entrada: "2026-10-20" }, { nome: "Clara", area: "RH", cargo: "Membro regular" }], HOJE);
    const chave = "00000000-0000-0000-0000-000000000002";
    expect(await importarMembros(bom, chave, admin)).toEqual({ ok: true, quantidade: 2 });
    expect(await importarMembros(bom, chave, admin)).toEqual({ ok: true, quantidade: 2 });
    expect(await db.membro.count()).toBe(2);
    expect(await db.posicao.findFirst({ where: { nome: "Membro regular de RH" } })).not.toBeNull();
  });

  it("membro já cadastrado pelo nome (sem e-mail) recusa o lote, como no G&G", async () => {
    const { admin } = await semear();
    await novo("Clara Souza", admin);
    const lote = validarImportacao([{ nome: "Vitor" }, { nome: " clara souza " }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000003", admin)).toMatchObject({ ok: false, erro: "IMPORTACAO", detalhe: "Linha 2: membro já cadastrado." });
    expect(await db.membro.count()).toBe(1);
  });

  it("membro já cadastrado pelo e-mail (sem caixa) recusa o lote; _ e % não são curinga", async () => {
    const { admin } = await semear();
    // Membro com status e período (o criarMembro do G&G abre um), sem posição: segue recusando, como antes.
    await novo("Joao", admin, "Joao.Silva@ij.test");
    const repetido = validarImportacao([{ nome: "Outro", email: "joao.silva@IJ.test" }], HOJE);
    expect(await importarMembros(repetido, "00000000-0000-0000-0000-000000000004", admin)).toMatchObject({ ok: false, erro: "IMPORTACAO", detalhe: "Linha 1: membro já cadastrado." });
    expect(await db.membro.count()).toBe(1);
    const parecidos = validarImportacao([{ nome: "Jo1", email: "jo_o.silva@ij.test" }, { nome: "Jo2", email: "jo%@ij.test" }], HOJE);
    expect(await importarMembros(parecidos, "00000000-0000-0000-0000-000000000005", admin)).toEqual({ ok: true, quantidade: 2 });
  });
});

describe("importação × cadastro pela Gestão (GAB-105)", () => {
  it("membro com o mesmo e-mail e sem ocupação é completado pela linha, sem derrubar o lote nem duplicar", async () => {
    const { admin } = await semear();
    const conta = await db.usuario.create({ data: { nome: "Lia", email: "lia@ij.test" } });
    const lia = await db.membro.create({ data: { nome: "Lia", email: "Lia@ij.test", status: "NAO_INFORMADO" } });
    const lote = validarImportacao([{ nome: "Lia Souza", email: "lia@IJ.test", status: "ativo", area: "Projetos", cargo: "PM", entrada: "2026-03-02" }, { nome: "Novo" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000006", admin)).toEqual({ ok: true, quantidade: 2 });
    expect(await db.membro.count()).toBe(2);
    const m = await db.membro.findUniqueOrThrow({ where: { id: lia.id }, include: { ocupacoes: true, vinculos: true } });
    expect(m).toMatchObject({ nome: "Lia", status: "ATIVO", usuarioId: conta.id });
    expect(m.ocupacoes.map((o) => [o.posicaoId, o.principal])).toEqual([["p_pm", true]]);
    expect(m.vinculos.map((v) => v.entrada?.toISOString().slice(0, 10))).toEqual(["2026-03-02"]);
  });

  it("membro com o mesmo e-mail com posição, ou com status e período, recusa o lote inteiro", async () => {
    const { admin } = await semear();
    const comPosicao = await db.membro.create({ data: { nome: "Rui", email: "rui@ij.test", status: "NAO_INFORMADO" } });
    await db.ocupacao.create({ data: { membroId: comPosicao.id, posicaoId: "p_sm" } });
    const lote = validarImportacao([{ nome: "Novo" }, { nome: "Rui", email: "rui@ij.test" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000007", admin)).toMatchObject({ ok: false, erro: "IMPORTACAO", detalhe: "Linha 2: membro já cadastrado." });
    const ativo = await db.membro.create({ data: { nome: "Sol", email: "sol@ij.test", status: "ATIVO" } });
    await db.vinculoIj.create({ data: { membroId: ativo.id, entrada: null } });
    expect(await importarMembros(validarImportacao([{ nome: "Sol", email: "sol@ij.test" }], HOJE), "00000000-0000-0000-0000-000000000008", admin)).toMatchObject({ ok: false, detalhe: "Linha 1: membro já cadastrado." });
    expect(await db.membro.count()).toBe(2);
  });
});

describe("importação: linha inativa fecha o período (GAB-106, M1 da revisão do GAB-105)", () => {
  it("membro NAO_INFORMADO com período aberto e linha inativa: fica INATIVO com o período fechado, como registrarSaida", async () => {
    const { admin } = await semear();
    const lia = await db.membro.create({ data: { nome: "Lia", email: "lia@ij.test", status: "NAO_INFORMADO" } });
    await db.vinculoIj.create({ data: { membroId: lia.id, entrada: new Date("2025-02-01T03:00:00Z") } });
    const lote = validarImportacao([{ nome: "Lia", email: "lia@ij.test", status: "inativo" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000009", admin)).toEqual({ ok: true, quantidade: 1 });
    const m = await db.membro.findUniqueOrThrow({ where: { id: lia.id }, include: { vinculos: true } });
    expect(m.status).toBe("INATIVO");
    expect(m.vinculos.map((v) => v.saida?.toISOString().slice(0, 10) ?? null)).toEqual([HOJE]);
    expect(await db.vinculoIj.count({ where: { membroId: lia.id, saida: null } })).toBe(0);
    expect((await db.historicoOrg.findMany({ where: { membroId: lia.id } })).map((h) => h.evento)).toContain("Saída da IJ registrada pela importação (data da importação)");
  });

  it("membro novo importado como inativo também não fica com período aberto", async () => {
    const { admin } = await semear();
    const lote = validarImportacao([{ nome: "Rui", status: "inativo", entrada: "2025-03-01" }, { nome: "Sol", status: "ativo" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000010", admin)).toEqual({ ok: true, quantidade: 2 });
    const rui = await db.membro.findFirstOrThrow({ where: { nome: "Rui" }, include: { vinculos: true } });
    expect(rui.status).toBe("INATIVO");
    expect(rui.vinculos.map((v) => [v.entrada?.toISOString().slice(0, 10), v.saida?.toISOString().slice(0, 10) ?? null])).toEqual([["2025-03-01", HOJE]]);
    const sol = await db.membro.findFirstOrThrow({ where: { nome: "Sol" }, include: { vinculos: true } });
    expect(sol.vinculos.map((v) => v.saida)).toEqual([null]);
  });
});

describe("importação: linha inativa com área e cargo não ocupa a vaga (GAB-106)", () => {
  it("a ocupação entra encerrada na data da importação, não principal; postosDe vazio e a posição segue vaga", async () => {
    const { admin } = await semear();
    const lote = validarImportacao([{ nome: "Ex PM", email: "ex.pm@ij.test", status: "inativo", area: "Projetos", cargo: "PM", entrada: "2025-03-01" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000011", admin)).toEqual({ ok: true, quantidade: 1 });
    const m = await db.membro.findFirstOrThrow({ where: { nome: "Ex PM" } });
    const ocs = await ocupacoes(m.id);
    expect(ocs.map((o) => [o.posicaoId, o.fim?.toISOString().slice(0, 10), o.principal])).toEqual([["p_pm", HOJE, false]]);
    const base = await carregarBase();
    expect(postosDe(base, m.id)).toEqual([]);
    // O organograma marca "Vago" a posição sem ocupação vigente.
    expect(base.ocupacoes.filter((o) => o.posicaoId === "p_pm" && vigente(o, base.hoje))).toEqual([]);
  });

  it("membro existente NAO_INFORMADO completado por linha inativa com posição: idem", async () => {
    const { admin } = await semear();
    const lia = await db.membro.create({ data: { nome: "Lia", email: "lia@ij.test", status: "NAO_INFORMADO" } });
    const lote = validarImportacao([{ nome: "Lia", email: "lia@ij.test", status: "inativo", area: "Projetos", cargo: "PM" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000012", admin)).toEqual({ ok: true, quantidade: 1 });
    expect(postosDe(await carregarBase(), lia.id)).toEqual([]);
    expect((await ocupacoes(lia.id)).map((o) => [o.fim?.toISOString().slice(0, 10), o.principal])).toEqual([[HOJE, false]]);
  });
});

describe("ehEditorGG com a base já carregada (GAB-106)", () => {
  it("responde igual sem ir ao banco de novo", async () => {
    const { admin, julia, paula, paulaU } = await semear();
    const m = await novo("Paula", admin, "paula@ij.test");
    await db.membro.update({ where: { id: m }, data: { usuarioId: paulaU.id } });
    await adicionarOcupante("p_grh", m, null, admin);
    const base = await carregarBase();
    for (const u of [admin, julia, paula]) expect(await ehEditorGG(u, base)).toBe(await ehEditorGG(u));
    expect(await ehEditorGG(paula, base)).toBe(true);
    expect(await ehEditorGG(julia, base)).toBe(false);
  });
});

describe("ligarConta pelo homônimo escolhido (GAB-106, M2 da revisão do GAB-105)", () => {
  it("se o homônimo ganhou e-mail no meio do cadastro, recusa em vez de sobrescrever", async () => {
    const { admin } = await semear();
    const conta = await db.usuario.create({ data: { nome: "Ana", email: "ana.nova@ij.test" } });
    const ana = await db.membro.create({ data: { nome: "Ana", status: "ATIVO" } });
    // Depois de a busca de homônimos ver a Ana sem e-mail, outra sessão grava um e-mail nela (a corrida).
    const espiar = <T extends object>(alvo: T, troca: (k: string | symbol, v: unknown) => unknown): T =>
      new Proxy(alvo, { get: (t, k) => troca(k, typeof Reflect.get(t, k) === "function" ? (Reflect.get(t, k) as (...a: unknown[]) => unknown).bind(t) : Reflect.get(t, k)) });
    const cadastro = db.$transaction(async (tx) => {
      const txEspiao = espiar(tx, (k, v) =>
        k !== "membro"
          ? v
          : espiar(tx.membro, (km, vm) =>
              km !== "findMany"
                ? vm
                : async (args: { where?: { email?: unknown } }) => {
                    const r = await tx.membro.findMany(args as never);
                    if (args?.where?.email === null) await db.membro.update({ where: { id: ana.id }, data: { email: "ana.outra@ij.test" } });
                    return r;
                  },
            ),
      );
      return membroDaContaTx(txEspiao, { usuarioId: conta.id, nome: "Ana", email: conta.email }, admin, { ligarMembroId: ana.id });
    });
    await expect(cadastro).rejects.toMatchObject({ erro: "MEMBRO_DE_OUTRA_CONTA" });
    expect(await db.membro.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ email: "ana.outra@ij.test", usuarioId: null });
  });
});

describe("contaPorEmail (ligar conta do CRM pelo e-mail)", () => {
  it("liga pela igualdade exata do e-mail normalizado; _ e % não casam outra conta", async () => {
    const { admin } = await semear();
    const joao = await db.usuario.create({ data: { nome: "Joao", email: "joao.silva@ij.test" } });
    const sublinhado = await novo("Jo1", admin, "jo_o.silva@ij.test");
    const porcento = await novo("Jo2", admin, "jo%@ij.test");
    expect((await db.membro.findUniqueOrThrow({ where: { id: sublinhado } })).usuarioId).toBeNull();
    expect((await db.membro.findUniqueOrThrow({ where: { id: porcento } })).usuarioId).toBeNull();
    expect(await ligarContasPorEmail(admin)).toEqual({ ok: true, ligados: 0 });
    const certo = await novo("Joao", admin, " Joao.Silva@IJ.test ");
    expect((await db.membro.findUniqueOrThrow({ where: { id: certo } })).usuarioId).toBe(joao.id);
  });
});
