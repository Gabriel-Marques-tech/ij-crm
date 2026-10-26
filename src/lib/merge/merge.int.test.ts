import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { criarContato, listarContatos, obterContato, buscarContatosPorNome, removerPonto } from "@/lib/contatos/contatos";
import { encontrarContatoPorIdentificador, encontrarEmpresa } from "@/lib/contatos/match";
import { criarEmpresa, listarEmpresas, obterEmpresa } from "@/lib/empresas/empresas";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { listarQuadro } from "@/lib/oportunidades/oportunidades";
import { desfazerMerge, destinoDeMesclado, mesclar, previaMerge } from "./merge";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

async function semear() {
  const p = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
  const vend = await db.usuario.create({ data: { nome: "Vera", email: "v@ij.test", papel: "VENDEDOR" } });
  const gestor = await db.usuario.create({ data: { nome: "Gil", email: "g@ij.test", papel: "GESTOR" } });
  const card = (titulo: string, dados: { contatoId?: string; empresaId?: string }) =>
    db.oportunidade.create({ data: { titulo, pipelineId: p.id, faseId: p.fases[0].id, responsavelId: vend.id, criadoVia: "UI", ...dados } });
  return { vend, gestor, card };
}

async function contatos() {
  const ana = await criarContato({ nome: "Ana Souza", pontos: ["ana@acme.com"] });
  const dup = await criarContato({ nome: "Ana S.", pontos: ["11 99999-8888", "ana.s@gmail.com"] });
  if (!ana.ok || !dup.ok) throw new Error("setup");
  return { ana: ana.id, dup: dup.id };
}

describe("merge de contatos", () => {
  it("prévia conta o que vai aparecer no principal; vendedor recebe SEM_PERMISSAO", async () => {
    const { vend, gestor, card } = await semear();
    const { ana, dup } = await contatos();
    await card("C1", { contatoId: ana });
    await card("C2", { contatoId: dup });
    await card("C3", { contatoId: dup });
    expect(await previaMerge("contato", ana, dup, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await mesclar("contato", ana, dup, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const r = await previaMerge("contato", ana, dup, gestor);
    expect(r).toMatchObject({
      ok: true,
      previa: {
        principal: { id: ana, contagens: { pontos: 1, oportunidades: 1 } },
        perdedor: { id: dup, contagens: { pontos: 2, oportunidades: 2 } },
        resultado: { pontos: 3, oportunidades: 3 },
      },
    });
    // Prévia não grava nada.
    expect((await db.contato.findUniqueOrThrow({ where: { id: dup } })).mergedIntoId).toBeNull();
  });

  it("leituras seguem o ponteiro: principal mostra pontos e oportunidades do mesclado; nada copiado; desfazer separa", async () => {
    const { gestor, card } = await semear();
    const { ana, dup } = await contatos();
    await card("C1", { contatoId: ana });
    const c2 = await card("C2", { contatoId: dup });
    expect(await mesclar("contato", ana, dup, gestor)).toEqual({ ok: true });

    const d = (await obterContato(ana))!;
    expect(d.pontos.map((p) => p.valorNormalizado).sort()).toEqual(["+5511999998888", "ana.s@gmail.com", "ana@acme.com"]);
    expect(d.oportunidades.map((o) => o.titulo).sort()).toEqual(["C1", "C2"]);
    expect(await obterContato(dup)).toBeNull();
    expect(await destinoDeMesclado("contato", dup)).toBe(ana);
    // Nada foi movido no banco.
    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: c2.id } })).contatoId).toBe(dup);
    expect(await db.contatoPonto.count({ where: { contatoId: dup } })).toBe(2);

    // Lista e autocomplete: mesclado some, principal aparece com tudo.
    const lista = await listarContatos();
    expect(lista.map((c) => c.id)).toEqual([ana]);
    expect(lista[0]._count.oportunidades).toBe(2);
    expect(lista[0].pontos).toHaveLength(3);
    expect((await listarContatos("11 99999-8888")).map((c) => c.id)).toEqual([ana]);
    expect((await buscarContatosPorNome("Ana")).map((c) => c.id)).toEqual([ana]);
    expect(await encontrarContatoPorIdentificador("11 99999-8888")).toMatchObject({ tipo: "ENCONTRADO", contato: { id: ana } });

    // Ponto vindo do mesclado pode ser removido pelo principal.
    const p = await db.contatoPonto.findFirstOrThrow({ where: { contatoId: dup, tipo: "EMAIL" } });
    expect(await removerPonto(ana, p.id)).toEqual({ ok: true });

    expect(await desfazerMerge("contato", dup, gestor)).toEqual({ ok: true, principalId: ana });
    expect((await obterContato(ana))!.oportunidades.map((o) => o.titulo)).toEqual(["C1"]);
    expect((await obterContato(dup))!.oportunidades.map((o) => o.titulo)).toEqual(["C2"]);
    expect(await desfazerMerge("contato", dup, gestor)).toMatchObject({ ok: false, erro: "NAO_MESCLADO" });
  });

  it("guardas: mesmo registro, ciclo (B→A depois de A→B), principal mesclado/excluído, perdedor com mesclados", async () => {
    const { gestor } = await semear();
    const { ana, dup } = await contatos();
    const c = await criarContato({ nome: "Carla" });
    if (!c.ok) throw new Error("setup");
    expect(await mesclar("contato", ana, ana, gestor)).toMatchObject({ ok: false, erro: "MESMO_REGISTRO" });
    expect(await mesclar("contato", ana, dup, gestor)).toEqual({ ok: true });
    expect(await mesclar("contato", dup, ana, gestor)).toMatchObject({ ok: false, erro: "PRINCIPAL_INVALIDO" }); // ciclo
    expect(await mesclar("contato", c.id, dup, gestor)).toMatchObject({ ok: false, erro: "PERDEDOR_INVALIDO" }); // já mesclado
    expect(await mesclar("contato", dup, c.id, gestor)).toMatchObject({ ok: false, erro: "PRINCIPAL_INVALIDO" }); // principal mesclado
    expect(await mesclar("contato", c.id, ana, gestor)).toMatchObject({ ok: false, erro: "PERDEDOR_TEM_MESCLADOS" }); // viraria 2 níveis
    await db.contato.update({ where: { id: c.id }, data: { deletadoEm: new Date() } });
    expect(await mesclar("contato", c.id, ana, gestor)).toMatchObject({ ok: false, erro: "PRINCIPAL_INVALIDO" });
  });
});

describe("merge de empresas", () => {
  it("contatos e oportunidades da mesclada aparecem na principal; CNPJ da mesclada acha a principal; desfazer separa", async () => {
    const { gestor, card } = await semear();
    const a = await criarEmpresa({ nome: "Acme" });
    const b = await criarEmpresa({ nome: "ACME Ltda", cnpj: "11.222.333/0001-81" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const zed = await criarContato({ nome: "Zé", empresaId: b.id });
    if (!zed.ok) throw new Error("setup");
    await card("E1", { empresaId: a.id });
    await card("E2", { empresaId: b.id });

    const pr = await previaMerge("empresa", a.id, b.id, gestor);
    expect(pr).toMatchObject({ ok: true, previa: { resultado: { contatos: 1, oportunidades: 2 } } });
    expect(await mesclar("empresa", a.id, b.id, gestor)).toEqual({ ok: true });

    const e = (await obterEmpresa(a.id))!;
    expect(e.contatos.map((c) => c.nome)).toEqual(["Zé"]);
    expect(e.oportunidades.map((o) => o.titulo).sort()).toEqual(["E1", "E2"]);
    const lista = await listarEmpresas();
    expect(lista.map((x) => [x.id, x._count.contatos, x._count.oportunidades])).toEqual([[a.id, 1, 2]]);
    expect((await listarEmpresas("11222333000181")).map((x) => x.id)).toEqual([a.id]);
    expect(await encontrarEmpresa("11.222.333/0001-81")).toEqual({ empresa: { id: a.id, nome: "Acme" }, via: "cnpj" });
    // Kanban mostra o nome da principal no card da mesclada.
    expect((await listarQuadro("vendas"))!.cards.map((c) => c.empresa?.nome)).toEqual(["Acme", "Acme"]);

    expect(await desfazerMerge("empresa", b.id, gestor)).toEqual({ ok: true, principalId: a.id });
    expect((await obterEmpresa(a.id))!.contatos).toHaveLength(0);
  });
});
