// @vitest-environment node
/**
 * GAB-108: migration 20261119120000_membros_das_contas. O schema de teste já está migrado (global
 * setup, banco vazio: a migration não fez nada); aqui o banco é montado como produção estava (contas
 * sem membro, membros importados sem conta) e o SQL da migration roda de novo — o mesmo arquivo que
 * o `prisma migrate deploy` roda. Rodar 2x não pode mudar nada.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { validarImportacao } from "./modelo";
import { importarMembros, type AtorGG } from "./organizacao";

const db = dbTeste();
const raiz = path.resolve(import.meta.dirname, "../../..");
const SQL = readFileSync(path.join(raiz, "prisma/migrations/20261119120000_membros_das_contas/migration.sql"), "utf8");

/** Comandos do arquivo (sem comentários `--`; o SQL não tem `;` nem `--` dentro de strings). */
const COMANDOS = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .split(";")
  .map((c) => c.trim())
  .filter(Boolean);

async function rodarMigracao() {
  await db.$transaction(async (tx) => {
    for (const c of COMANDOS) await tx.$executeRawUnsafe(c);
  });
}

const dia = (n: number) => new Date(Date.UTC(2025, 0, n));

async function foto() {
  const membros = await db.membro.findMany({ orderBy: { id: "asc" }, select: { id: true, nome: true, email: true, status: true, usuarioId: true, atualizadoEm: true } });
  const vinculos = await db.vinculoIj.findMany({ orderBy: { id: "asc" } });
  const historico = await db.historicoOrg.findMany({ orderBy: { id: "asc" }, select: { id: true, membroId: true, evento: true, autorId: true } });
  return { membros, vinculos, historico };
}

beforeEach(() => limparBanco(["historico_org", "importacao_membros", "ocupacao", "vinculo_ij", "membro", "posicao", "cargo_org", "area_org", "usuario"]));

const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

describe("migration membros_das_contas (GAB-108)", () => {
  it("cria/liga um membro para cada conta, sem violar membro_email_unico, e rodar 2x é no-op", async () => {
    // conta comum, sem membro
    const ana = await db.usuario.create({ data: { nome: " Ana Lima ", email: "Ana@IJ.test", criadoEm: dia(1) } });
    // conta que casa com membro órfão (importado) por e-mail, com caixa/espaço diferentes
    const bia = await db.usuario.create({ data: { nome: "Bia", email: "bia@ij.test", criadoEm: dia(2) } });
    const biaMembro = await db.membro.create({ data: { nome: "Beatriz (planilha)", email: "BIA@ij.test", status: "NAO_INFORMADO" } });
    await db.usuario.update({ where: { id: bia.id }, data: { email: "  bia@IJ.test " } });
    // conta inativa, sem membro
    const caio = await db.usuario.create({ data: { nome: "Caio", email: "caio@ij.test", ativo: false, criadoEm: dia(3) } });
    // conta já ligada: não muda
    const duda = await db.usuario.create({ data: { nome: "Duda", email: "duda@ij.test", criadoEm: dia(4) } });
    const dudaMembro = await db.membro.create({ data: { nome: "Duda G&G", email: "outro@ij.test", status: "AFASTADO", usuarioId: duda.id } });
    // colisão: o e-mail da conta já é de um membro ligado a OUTRA conta → membro novo sem e-mail
    const eva = await db.usuario.create({ data: { nome: "Eva", email: "OUTRO@ij.test ", criadoEm: dia(5) } });
    // conta inativa que casa com órfão NAO_INFORMADO: liga, mas não ativa
    const fabio = await db.usuario.create({ data: { nome: "Fábio", email: "fabio@ij.test", ativo: false, criadoEm: dia(6) } });
    const fabioMembro = await db.membro.create({ data: { nome: "Fábio", email: "fabio@ij.test", status: "NAO_INFORMADO" } });
    // órfão INATIVO + conta ativa: liga e mantém o status (reingresso é decisão da Gestão)
    const gil = await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", criadoEm: dia(7) } });
    const gilMembro = await db.membro.create({ data: { nome: "Gil", email: "gil@ij.test", status: "INATIVO" } });
    // órfão sem conta que casa com ninguém: intocado
    const orfao = await db.membro.create({ data: { nome: "Órfão", email: "orfao@ij.test", status: "ATIVO" } });
    // e-mail parecido (prefixo) não casa: só igualdade exata
    const hugo = await db.usuario.create({ data: { nome: "Hugo", email: "hugo@ij.test", criadoEm: dia(8) } });
    const hugoParecido = await db.membro.create({ data: { nome: "Hugo Parecido", email: "hugo@ij.test.br" } });

    // e-mail da conta que não passa no CHECK membro_email: membro sem e-mail (a migration não quebra)
    const ivo = await db.usuario.create({ data: { nome: "Ivo", email: "ivo@localhost", criadoEm: dia(9) } });

    const antesDuda =await db.membro.findUniqueOrThrow({ where: { id: dudaMembro.id } });

    await rodarMigracao();

    const doUsuario = async (usuarioId: string) => db.membro.findUniqueOrThrow({ where: { usuarioId } });

    // toda conta tem membro
    expect(await db.usuario.count()).toBe(9);
    expect(await db.membro.count({ where: { usuarioId: { not: null } } })).toBe(9);
    expect(await doUsuario(ivo.id)).toMatchObject({ nome: "Ivo", email: null, status: "ATIVO" });

    const mAna = await doUsuario(ana.id);
    expect(mAna).toMatchObject({ nome: "Ana Lima", email: "ana@ij.test", status: "ATIVO" });
    expect(mAna.id.startsWith("gab108")).toBe(true);
    expect(await db.vinculoIj.findMany({ where: { membroId: mAna.id } })).toMatchObject([{ entrada: null, saida: null }]);
    expect(await db.historicoOrg.findMany({ where: { membroId: mAna.id } })).toMatchObject([{ evento: expect.stringContaining("Membro criado a partir da conta"), autorId: null }]);

    // ligado o órfão existente (mesmo id), NAO_INFORMADO → ATIVO, nome/e-mail dele preservados
    const mBia = await doUsuario(bia.id);
    expect(mBia).toMatchObject({ id: biaMembro.id, nome: "Beatriz (planilha)", email: "BIA@ij.test", status: "ATIVO" });
    expect(await db.vinculoIj.count({ where: { membroId: mBia.id, saida: null } })).toBe(1);
    expect(await db.historicoOrg.findMany({ where: { membroId: mBia.id } })).toMatchObject([{ evento: expect.stringContaining("ligada pelo e-mail") }]);

    const mCaio = await doUsuario(caio.id);
    expect(mCaio).toMatchObject({ nome: "Caio", email: "caio@ij.test", status: "INATIVO" });
    expect(await db.vinculoIj.count({ where: { membroId: mCaio.id } })).toBe(0);

    expect(await db.membro.findUniqueOrThrow({ where: { id: dudaMembro.id } })).toEqual(antesDuda);
    expect(await db.historicoOrg.count({ where: { membroId: dudaMembro.id } })).toBe(0);

    expect(await doUsuario(eva.id)).toMatchObject({ nome: "Eva", email: null, status: "ATIVO" });

    expect(await doUsuario(fabio.id)).toMatchObject({ id: fabioMembro.id, status: "NAO_INFORMADO" });
    expect(await db.vinculoIj.count({ where: { membroId: fabioMembro.id } })).toBe(0);

    expect(await doUsuario(gil.id)).toMatchObject({ id: gilMembro.id, status: "INATIVO" });
    expect(await db.vinculoIj.count({ where: { membroId: gilMembro.id } })).toBe(0);

    expect(await db.membro.findUniqueOrThrow({ where: { id: orfao.id } })).toMatchObject({ usuarioId: null, status: "ATIVO" });

    const mHugo = await doUsuario(hugo.id);
    expect(mHugo.id).not.toBe(hugoParecido.id);
    expect(mHugo.email).toBe("hugo@ij.test");
    expect(await db.membro.findUniqueOrThrow({ where: { id: hugoParecido.id } })).toMatchObject({ usuarioId: null });

    // 2ª execução: nada muda
    const depois1 = await foto();
    await rodarMigracao();
    expect(await foto()).toEqual(depois1);
  });

  it("duas contas com o mesmo e-mail normalizado: a mais antiga fica com o e-mail (ou com o órfão)", async () => {
    const velha = await db.usuario.create({ data: { nome: "Velha", email: "par@ij.test", criadoEm: dia(1) } });
    const nova = await db.usuario.create({ data: { nome: "Nova", email: " PAR@ij.test", criadoEm: dia(2) } });
    const outraVelha = await db.usuario.create({ data: { nome: "Outra velha", email: "orf@ij.test", criadoEm: dia(3) } });
    const outraNova = await db.usuario.create({ data: { nome: "Outra nova", email: "ORF@ij.test", criadoEm: dia(4) } });
    const orfao = await db.membro.create({ data: { nome: "Órfão", email: "orf@ij.test" } });

    await rodarMigracao();

    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: velha.id } })).toMatchObject({ email: "par@ij.test" });
    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: nova.id } })).toMatchObject({ email: null });
    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: outraVelha.id } })).toMatchObject({ id: orfao.id });
    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: outraNova.id } })).toMatchObject({ email: null });

    const depois1 = await foto();
    await rodarMigracao();
    expect(await foto()).toEqual(depois1);
  });

  it("banco sem contas: não faz nada", async () => {
    await db.membro.create({ data: { nome: "Solto", email: "solto@ij.test" } });
    const antes = await foto();
    await rodarMigracao();
    expect(await foto()).toEqual(antes);
  });

  it("nome no CHECK membro_nome (corta em 200; vazio vira a parte local do e-mail), VISUALIZADOR fica de fora, homônimo sem e-mail não duplica", async () => {
    const longo = await db.usuario.create({ data: { nome: `  ${"x".repeat(250)}  `, email: "longo@ij.test" } });
    const vazio = await db.usuario.create({ data: { nome: "   ", email: " Zeca.Silva@ij.test" } });
    const visu = await db.usuario.create({ data: { nome: "Visu", email: "visu@ij.test", papel: "VISUALIZADOR" } });
    // VISUALIZADOR nem liga ao órfão de mesmo e-mail
    const visuOrfao = await db.membro.create({ data: { nome: "Visu Planilha", email: "visu@ij.test" } });
    const homonimoOrfao = await db.membro.create({ data: { nome: "José  Souza", status: "ATIVO" } });
    const jose = await db.usuario.create({ data: { nome: " jose souza", email: "jose@ij.test" } });
    // homônimo COM e-mail (é outra pessoa, ou já tem ficha) não bloqueia
    await db.membro.create({ data: { nome: "Rita", email: "rita.antiga@ij.test" } });
    const rita = await db.usuario.create({ data: { nome: "Rita", email: "rita@ij.test" } });

    await rodarMigracao();

    const mLongo = await db.membro.findUniqueOrThrow({ where: { usuarioId: longo.id } });
    expect(mLongo.nome).toBe("x".repeat(200));
    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: vazio.id } })).toMatchObject({ nome: "Zeca.Silva", email: "zeca.silva@ij.test" });
    expect(await db.membro.findUnique({ where: { usuarioId: visu.id } })).toBeNull();
    expect(await db.membro.findUniqueOrThrow({ where: { id: visuOrfao.id } })).toMatchObject({ usuarioId: null });
    expect(await db.membro.findUnique({ where: { usuarioId: jose.id } })).toBeNull();
    expect(await db.membro.findUniqueOrThrow({ where: { id: homonimoOrfao.id } })).toMatchObject({ usuarioId: null, email: null });
    expect(await db.membro.findUniqueOrThrow({ where: { usuarioId: rita.id } })).toMatchObject({ nome: "Rita", email: "rita@ij.test" });

    const depois1 = await foto();
    await rodarMigracao();
    expect(await foto()).toEqual(depois1);
  });
});

describe("importação depois da migration (GAB-108)", () => {
  async function semear() {
    await db.areaOrg.create({ data: { id: "vend", nome: "Vendas", ladoCrm: "VENDAS" } });
    await db.cargoOrg.create({ data: { id: "mem", nome: "Membro regular", categoria: "MEMBRO" } });
    const admin = await db.usuario.create({ data: { nome: "Alice", email: "alice@ij.test", papel: "ADMIN" } });
    const ator: AtorGG = { id: admin.id, nome: admin.nome, papel: admin.papel };
    return ator;
  }

  it("linha com o e-mail de quem tem conta completa o membro criado pela migration (área, cargo, entrada)", async () => {
    const ator = await semear();
    const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
    await rodarMigracao();
    const criado = await db.membro.findUniqueOrThrow({ where: { usuarioId: ana.id } });

    const lote = validarImportacao([{ nome: "Ana Lima", email: "ANA@ij.test", status: "ativo", area: "Vendas", cargo: "Membro regular", entrada: "2025-03-03" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000108", ator)).toEqual({ ok: true, quantidade: 1 });

    expect(await db.membro.count({ where: { usuarioId: ana.id } })).toBe(1);
    const m = await db.membro.findUniqueOrThrow({ where: { id: criado.id }, include: { ocupacoes: { include: { posicao: true } }, vinculos: true } });
    expect(m.status).toBe("ATIVO");
    expect(m.ocupacoes.map((o) => [o.posicao.areaId, o.posicao.cargoId, o.principal])).toEqual([["vend", "mem", true]]);
    expect(m.vinculos.map((v) => [v.entrada?.toISOString().slice(0, 10), v.saida])).toEqual([["2025-03-03", null]]);
  });

  it("linha sem e-mail com o nome de quem tem conta recusa pedindo o e-mail; o membro da conta fica intocado", async () => {
    const ator = await semear();
    const ana = await db.usuario.create({ data: { nome: "Ana Lima", email: "ana@ij.test" } });
    await rodarMigracao();
    const antes = await db.membro.findUniqueOrThrow({ where: { usuarioId: ana.id }, include: { ocupacoes: true, vinculos: true } });

    // outra "Ana Lima", sem e-mail na planilha
    const lote = validarImportacao([{ nome: "ana  lima", area: "Vendas", cargo: "Membro regular", entrada: "2025-04-01" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000109", ator)).toMatchObject({
      ok: false,
      erro: "IMPORTACAO",
      detalhe: "Linha 1: já existe membro com conta e esse nome; informe o e-mail na planilha.",
    });
    expect(await db.membro.findUniqueOrThrow({ where: { id: antes.id }, include: { ocupacoes: true, vinculos: true } })).toEqual(antes);
    expect(await db.membro.count()).toBe(2); // Ana + Alice
  });

  it("nome com _ ou % não é curinga: \"Al_ce\" vira membro próprio e não encosta na Alice", async () => {
    const ator = await semear();
    await rodarMigracao();
    const alice = await db.membro.findUniqueOrThrow({ where: { usuarioId: ator.id }, include: { ocupacoes: true, vinculos: true } });

    const lote = validarImportacao([{ nome: "Al_ce", area: "Vendas", cargo: "Membro regular" }, { nome: "%" }], HOJE);
    expect(await importarMembros(lote, "00000000-0000-0000-0000-000000000110", ator)).toEqual({ ok: true, quantidade: 2 });
    expect(await db.membro.findUniqueOrThrow({ where: { id: alice.id }, include: { ocupacoes: true, vinculos: true } })).toEqual(alice);
    expect((await db.membro.findMany({ where: { usuarioId: null }, orderBy: { nome: "asc" } })).map((m) => m.nome)).toEqual(["%", "Al_ce"]);
  });
});
