import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { semear } from "../../../../prisma/seed";
import { lerArgs, rodarCli, validarColunas, type IoCli } from "./cli";

const db = dbTeste();
const ARQ = path.resolve(import.meta.dirname, "../../../test/fixtures/pipefy/export-exemplo.csv");
const AGORA = new Date("2026-03-01T12:00:00Z");

function io(env: Record<string, string> = {}) {
  const saida: string[] = [];
  const erros: string[] = [];
  const escritos = new Map<string, string>();
  const x: IoCli = {
    log: (m) => saida.push(m),
    erro: (m) => erros.push(m),
    ler: (c) => readFileSync(c),
    escrever: (c, s) => escritos.set(c, s),
    env,
  };
  return { x, saida, erros, escritos };
}

beforeEach(async () => {
  await limparBanco(["import_previa", "transicao_fase", "timeline", "oportunidade", "contato_ponto", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  await semear(db, { log: () => {} });
});

describe("lerArgs", () => {
  it("arquivo + flags; erros de uso", () => {
    expect(lerArgs(["a.csv", "--confirmar", "--usuario", "x@y.z"])).toEqual({ ok: true, args: { arquivo: "a.csv", confirmar: true, mapa: undefined, colunas: undefined, usuario: "x@y.z" } });
    expect(lerArgs([])).toEqual({ ok: false, erro: "Informe o arquivo CSV." });
    expect(lerArgs(["a.csv", "--mapa"])).toEqual({ ok: false, erro: "--mapa precisa de um valor." });
    expect(lerArgs(["a.csv", "--forca"])).toEqual({ ok: false, erro: "Opção desconhecida: --forca" });
  });
});

describe("validarColunas", () => {
  it("aceita campos conhecidos com lista de textos; recusa o resto", () => {
    expect(validarColunas({ telefone: ["Fone do lead"] })).toEqual({ ok: true, extras: { telefone: ["Fone do lead"] } });
    expect(validarColunas({ fone: ["x"] })).toMatchObject({ ok: false, erro: expect.stringContaining('campo desconhecido "fone"') });
    expect(validarColunas({ telefone: "x" })).toMatchObject({ ok: false });
    expect(validarColunas([])).toMatchObject({ ok: false });
  });
});

describe("rodarCli", () => {
  it("dry-run não grava nada e salva o CSV de erros; --confirmar importa; rodar de novo só atualiza", async () => {
    await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    const seco = io();
    expect(await rodarCli([ARQ], seco.x, AGORA)).toBe(0);
    expect(await db.oportunidade.count()).toBe(0);
    expect(seco.saida.join("\n")).toMatch(/dry-run: nada foi gravado/);
    expect(seco.escritos.get(`${ARQ}.erros.csv`)).toMatch(/^﻿linha;id_pipefy;tipo;mensagem/);

    const conf = io();
    expect(await rodarCli([ARQ, "--confirmar"], conf.x, AGORA)).toBe(0);
    const criados = await db.oportunidade.count();
    expect(criados).toBeGreaterThan(0);
    expect(conf.saida.join("\n")).toMatch(/import concluído: criados \d+, atualizados 0/);

    const de_novo = io();
    expect(await rodarCli([ARQ, "--confirmar"], de_novo.x, AGORA)).toBe(0);
    expect(await db.oportunidade.count()).toBe(criados);
    expect(de_novo.saida.join("\n")).toMatch(/criados 0, atualizados [1-9]/);
  });

  it("sem ADMIN ativo, ou usuário VENDEDOR → erro e nada gravado", async () => {
    const semAdmin = io();
    expect(await rodarCli([ARQ, "--confirmar"], semAdmin.x, AGORA)).toBe(1);
    expect(semAdmin.erros[0]).toMatch(/Nenhum ADMIN ativo/);
    await db.usuario.create({ data: { nome: "Vend", email: "vend@ij.test", papel: "VENDEDOR" } });
    const vend = io({ IMPORT_USUARIO_EMAIL: "Vend@IJ.test" });
    expect(await rodarCli([ARQ, "--confirmar"], vend.x, AGORA)).toBe(1);
    expect(vend.erros[0]).toBe("vend@ij.test precisa ser ADMIN ou GESTOR ativo.");
    expect(await db.oportunidade.count()).toBe(0);
  });

  it("--motivo-perda: chave inválida recusa; válida aplica aos perdidos sem motivo", async () => {
    await db.usuario.create({ data: { nome: "Admin", email: "admin@ij.test", papel: "ADMIN" } });
    expect(lerArgs(["a.csv", "--motivo-perda", "preco"])).toMatchObject({ ok: true, args: { motivoPerda: "preco" } });
    const ruim = io();
    expect(await rodarCli([ARQ, "--motivo-perda", "caro"], ruim.x, AGORA)).toBe(1);
    expect(ruim.erros[0]).toMatch(/^Motivo de perda padrão inválido/);
    const seco = io();
    expect(await rodarCli([ARQ], seco.x, AGORA)).toBe(0);
    expect(seco.saida.join("\n")).not.toMatch(/perdidos sem motivo/); // a fixture tem motivo em todos os perdidos
  });

  it("arquivo inexistente → erro legível", async () => {
    const r = io();
    expect(await rodarCli(["/nao/existe.csv"], r.x, AGORA)).toBe(1);
    expect(r.erros[0]).toMatch(/Não consegui ler \/nao\/existe\.csv/);
  });
});
