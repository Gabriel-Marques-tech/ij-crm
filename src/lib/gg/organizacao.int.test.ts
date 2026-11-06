// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { validarImportacao } from "./modelo";
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
  it("PM de Projetos sugere PROJETOS + GP; diretor sugere GESTOR; contas ligam pelo e-mail", async () => {
    const { admin, paulaU } = await semear();
    const paula = await db.membro.create({ data: { nome: "Paula", email: "PAULA@ij.test", status: "ATIVO" } });
    expect(await ligarContasPorEmail(admin)).toEqual({ ok: true, ligados: 1 });
    expect((await db.membro.findUniqueOrThrow({ where: { id: paula.id } })).usuarioId).toBe(paulaU.id);
    await adicionarOcupante("p_pm", paula.id, null, admin);
    const g = await novo("Guto", admin);
    await adicionarOcupante("p_dproj", g, null, admin);
    const base = await carregarBase();
    expect(derivadoDe(base, paula.id)).toEqual({ area: "PROJETOS", papel: "PROJETOS", gp: true, conflito: null });
    expect(derivadoDe(base, g)).toMatchObject({ area: "PROJETOS", papel: "GESTOR", gp: false });
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
});
