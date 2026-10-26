import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { obterVinculosDoCard, vincularAoCard } from "./vinculos";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["timeline", "transicao_fase", "oportunidade", "fase", "pipeline", "contato_ponto", "contato", "empresa", "sessao", "usuario"]);
});

async function semear() {
  const p = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", fases: { create: [{ chave: "a", nome: "A", ordem: 0 }] } }, include: { fases: true } });
  const u = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const card = await db.oportunidade.create({ data: { pipelineId: p.id, faseId: p.fases[0].id, titulo: "Card", responsavelId: u.id, criadoVia: "UI" } });
  return { u, card };
}

describe("vincularAoCard", () => {
  it("vincula, troca e desvincula empresa com Timeline CAMPO_ALTERADO por nome", async () => {
    const { u, card } = await semear();
    const acme = await db.empresa.create({ data: { nome: "Acme" } });
    const beta = await db.empresa.create({ data: { nome: "Beta" } });

    expect(await vincularAoCard(card.id, "empresa", acme.id, u)).toEqual({ ok: true, mudou: true });
    expect(await vincularAoCard(card.id, "empresa", acme.id, u)).toEqual({ ok: true, mudou: false }); // no-op
    expect(await vincularAoCard(card.id, "empresa", beta.id, u)).toEqual({ ok: true, mudou: true });
    expect(await vincularAoCard(card.id, "empresa", null, u)).toEqual({ ok: true, mudou: true });

    expect((await db.oportunidade.findUniqueOrThrow({ where: { id: card.id } })).empresaId).toBeNull();
    const t = await db.timeline.findMany({ where: { oportunidadeId: card.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(t.map((x) => [x.tipo, x.usuarioId])).toEqual(Array(3).fill(["CAMPO_ALTERADO", u.id]));
    expect(t.map((x) => x.payload)).toEqual([
      { campo: "empresa", antes: null, depois: "Acme", antesId: null, depoisId: acme.id },
      { campo: "empresa", antes: "Acme", depois: "Beta", antesId: acme.id, depoisId: beta.id },
      { campo: "empresa", antes: "Beta", depois: null, antesId: beta.id, depoisId: null },
    ]);
  });

  it("vincula contato (sem empresa) independente da empresa do card", async () => {
    const { u, card } = await semear();
    const ana = await db.contato.create({ data: { nome: "Ana" } });
    expect(await vincularAoCard(card.id, "contato", ana.id, u)).toEqual({ ok: true, mudou: true });
    const op = await db.oportunidade.findUniqueOrThrow({ where: { id: card.id } });
    expect([op.contatoId, op.empresaId]).toEqual([ana.id, null]);
    const t = await db.timeline.findFirstOrThrow({ where: { oportunidadeId: card.id } });
    expect(t.payload).toEqual({ campo: "contato", antes: null, depois: "Ana", antesId: null, depoisId: ana.id });
  });

  it("recusa alvo deletado/mesclado/inexistente e card soft-deletado, sem Timeline", async () => {
    const { u, card } = await semear();
    const morta = await db.empresa.create({ data: { nome: "Morta", deletadoEm: new Date() } });
    const destino = await db.contato.create({ data: { nome: "Destino" } });
    const mesclado = await db.contato.create({ data: { nome: "Dup", mergedIntoId: destino.id } });
    expect(await vincularAoCard(card.id, "empresa", morta.id, u)).toEqual({ ok: false, erro: "EMPRESA_NAO_ENCONTRADA" });
    expect(await vincularAoCard(card.id, "contato", mesclado.id, u)).toEqual({ ok: false, erro: "CONTATO_NAO_ENCONTRADO" });
    expect(await vincularAoCard(card.id, "contato", "nao-existe", u)).toEqual({ ok: false, erro: "CONTATO_NAO_ENCONTRADO" });
    await db.oportunidade.update({ where: { id: card.id }, data: { deletadoEm: new Date() } });
    expect(await vincularAoCard(card.id, "contato", destino.id, u)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await db.timeline.count()).toBe(0);
  });
});

describe("obterVinculosDoCard", () => {
  it("empresa mesclada aponta o destino; contato excluído vem marcado; nada aparece como ativo", async () => {
    const { card } = await semear();
    const destino = await db.empresa.create({ data: { nome: "Beta" } });
    const mesclada = await db.empresa.create({ data: { nome: "Beta dup", mergedIntoId: destino.id } });
    const morto = await db.contato.create({ data: { nome: "Morto", deletadoEm: new Date() } });
    await db.oportunidade.update({ where: { id: card.id }, data: { empresaId: mesclada.id, contatoId: morto.id } });
    expect(await obterVinculosDoCard(card.id)).toEqual({
      empresa: { estado: "MESCLADO", id: mesclada.id, nome: "Beta dup", destino: { id: destino.id, nome: "Beta" } },
      contato: { estado: "EXCLUIDO", id: morto.id, nome: "Morto" },
    });
  });

  it("vivos → ATIVO; sem vínculo → null; card soft-deletado → null", async () => {
    const { card } = await semear();
    const acme = await db.empresa.create({ data: { nome: "Acme" } });
    await db.oportunidade.update({ where: { id: card.id }, data: { empresaId: acme.id } });
    expect(await obterVinculosDoCard(card.id)).toEqual({ empresa: { estado: "ATIVO", id: acme.id, nome: "Acme" }, contato: null });
    await db.oportunidade.update({ where: { id: card.id }, data: { deletadoEm: new Date() } });
    expect(await obterVinculosDoCard(card.id)).toBeNull();
  });
});
