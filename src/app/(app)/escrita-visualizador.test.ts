// @vitest-environment node
/**
 * Papel VISUALIZADOR (somente leitura): TODA server action que escreve no CRM
 * passa por `exigirEscrita` antes de tocar no serviço — chamar a action direto
 * (sem a UI) dá /403. Leituras (autocomplete) e a preferência de visualização
 * do próprio usuário seguem abertas (`exigirUsuario`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exigirEscrita, exigirUsuario, proibido } = vi.hoisted(() => {
  const proibido = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/403;307;" });
  return {
    proibido,
    exigirEscrita: vi.fn(async () => {
      throw proibido;
    }),
    exigirUsuario: vi.fn(async () => ({ id: "v1", nome: "Vera", email: "vera@ij.test", papel: "VISUALIZADOR" as const })),
  };
});

vi.mock("@/lib/auth/atual", () => ({ exigirEscrita, exigirUsuario, exigirPapel: vi.fn(async () => ({ id: "v1", papel: "VISUALIZADOR" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/oportunidades/oportunidades");
vi.mock("@/lib/oportunidades/feita");
vi.mock("@/lib/oportunidades/vinculos");
vi.mock("@/lib/prazos/prazos");
vi.mock("@/lib/contatos/contatos");
vi.mock("@/lib/empresas/empresas");
vi.mock("@/lib/lixeira/cards");
vi.mock("@/lib/preferencias/servico");

const kanban = await import("./kanban/actions");
const vinculos = await import("./kanban/[id]/vinculos-actions");
const calendario = await import("./_calendario/actions");
const semana = await import("./_semana/actions");
const contatos = await import("./contatos/actions");
const empresas = await import("./empresas/actions");
const lixeira = await import("./_lixeira/actions");
const oportunidades = await import("@/lib/oportunidades/oportunidades");
const feita = await import("@/lib/oportunidades/feita");
const servVinculos = await import("@/lib/oportunidades/vinculos");
const prazos = await import("@/lib/prazos/prazos");
const servContatos = await import("@/lib/contatos/contatos");
const servEmpresas = await import("@/lib/empresas/empresas");
const lixeiraCards = await import("@/lib/lixeira/cards");
const preferencias = await import("@/lib/preferencias/servico");

const ESCRITAS: [string, () => Promise<unknown>][] = [
  ["kanban.criarCard", () => kanban.criarCardAction("p1", "f1", "Card")],
  ["kanban.moverCard", () => kanban.moverCardAction("c1", "f2")],
  ["kanban.editarCampo", () => kanban.editarCampoAction("c1", "titulo", "Novo")],
  ["kanban.adicionarNota", () => kanban.adicionarNotaAction("c1", "oi")],
  ["kanban.vincular", () => vinculos.vincularAction("c1", "empresa", "e1")],
  ["kanban.criarEmpresa", () => vinculos.criarEVincularEmpresaAction("c1", "ACME")],
  ["kanban.criarContato", () => vinculos.criarEVincularContatoAction("c1", { nome: "Zé" })],
  ["calendario.criarPrazo", () => calendario.criarPrazoAction({ titulo: "x", dia: "2026-10-30", responsavelId: "v1" })],
  ["calendario.editarPrazo", () => calendario.editarPrazoAction("pz1", { titulo: "x", dia: "2026-10-30", responsavelId: "v1" })],
  ["calendario.concluirPrazo", () => calendario.concluirPrazoAction("pz1", true)],
  ["calendario.excluirPrazo", () => calendario.excluirPrazoAction("pz1")],
  ["semana.marcarFeita", () => semana.marcarFeitaAction("c1", { proximaAcao: "Ligar", dia: "2026-10-29" }, { tipo: "nenhuma" })],
  ["semana.definirProxima", () => semana.definirProximaAction("c1", "Ligar", "2026-10-30")],
  ["contatos.criar", () => contatos.criarContatoAction({ nome: "Zé" })],
  ["contatos.editarCampo", () => contatos.editarContatoCampoAction("ct1", "nome", "Zé")],
  ["contatos.definirEmpresa", () => contatos.definirEmpresaDoContatoAction("ct1", null)],
  ["contatos.adicionarPonto", () => contatos.adicionarPontoAction("ct1", "EMAIL", "ze@x.com")],
  ["contatos.removerPonto", () => contatos.removerPontoAction("ct1", "pt1")],
  ["empresas.criar", () => empresas.criarEmpresaAction({ nome: "ACME" })],
  ["empresas.editarCampo", () => empresas.editarEmpresaCampoAction("e1", "nome", "ACME")],
  ["lixeira.excluirCard", () => lixeira.excluirCardAction("c1", "vendas")],
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("VISUALIZADOR não escreve (server actions)", () => {
  it.each(ESCRITAS)("%s → /403 pelo exigirEscrita, sem chamar o serviço", async (_nome, chamar) => {
    await expect(chamar()).rejects.toBe(proibido);
    expect(exigirEscrita).toHaveBeenCalledTimes(1);
    expect(exigirUsuario).not.toHaveBeenCalled();
    for (const servico of [oportunidades, feita, servVinculos, prazos, servContatos, servEmpresas, lixeiraCards]) {
      for (const fn of Object.values(servico)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it("leituras e a visualização do próprio quadro seguem abertas", async () => {
    vi.mocked(servContatos.buscarContatosPorNome).mockResolvedValue([]);
    vi.mocked(servEmpresas.buscarEmpresasPorNome).mockResolvedValue([]);
    vi.mocked(preferencias.salvarVisualizacaoKanban).mockResolvedValue({ ok: true } as never);
    expect(await contatos.buscarContatosAction("zé")).toEqual({ ok: true, opcoes: [] });
    expect(await empresas.buscarEmpresasAction("acme")).toEqual({ ok: true, opcoes: [] });
    expect(await kanban.salvarVisualizacaoKanbanAction("vendas", { mostrarVazias: true, abertas: [] })).toEqual({ ok: true });
    expect(exigirEscrita).not.toHaveBeenCalled();
    expect(preferencias.salvarVisualizacaoKanban).toHaveBeenCalledWith("v1", "vendas", { mostrarVazias: true, abertas: [] });
  });
});
