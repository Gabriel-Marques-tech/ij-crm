import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Previa } from "@/lib/importacao/pipefy/servico";

const previsualizar = vi.fn();
const remapear = vi.fn();
const confirmar = vi.fn();
vi.mock("./actions", () => ({
  previsualizarImportAction: (...a: unknown[]) => previsualizar(...a),
  remapearImportAction: (...a: unknown[]) => remapear(...a),
  confirmarImportAction: (...a: unknown[]) => confirmar(...a),
}));

const { ImportarPipefy } = await import("./importar-pipefy");

const T1 = "1".repeat(64);
const T2 = "2".repeat(64);

function previa(extra: Partial<Previa> = {}): Previa {
  return {
    nomeArquivo: "export.csv",
    hash: "h".repeat(64),
    separador: ";",
    totalLinhas: 4,
    cards: 3,
    novos: 2,
    existentes: 0,
    duplicadas: 1,
    comProjeto: 1,
    perdidosSemMotivo: 0,
    opcoes: {},
    fases: [
      { chave: "lead", nome: "Lead", cardsAtuais: 2, faseId: "f-lead" },
      { chave: "fase misteriosa", nome: "Fase misteriosa", cardsAtuais: 1, faseId: null },
    ],
    fasesCrm: [
      { id: "f-lead", chave: "lead", nome: "Lead", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: null },
      { id: "f-ganho", chave: "contrato_assinado", nome: "Contrato assinado", pipelineChave: "vendas", pipelineNome: "Vendas", tipoTerminal: "GANHO" },
    ],
    responsaveisSemMatch: [{ nome: "Fulano Externo", cards: 2 }],
    erros: [{ linha: 4, pipefyId: "9", mensagem: 'Fase "Fase misteriosa" sem correspondência no CRM (mapeie abaixo).' }],
    avisos: [],
    colunasReconhecidas: ["pipefyId", "titulo"],
    colunasHistorico: 0,
    colunasIgnoradas: [],
    ...extra,
  };
}

async function enviarArquivo() {
  render(<ImportarPipefy />);
  const input = screen.getByLabelText("Arquivo CSV do Pipefy");
  fireEvent.change(input, { target: { files: [new File(["ID\n1"], "export.csv", { type: "text/csv" })] } });
  // submit direto: o jsdom não preenche `input.files` de verdade, e o `required` barraria o clique.
  fireEvent.submit(screen.getByRole("button", { name: "Ver prévia" }).closest("form")!);
}

beforeEach(() => vi.clearAllMocks());

describe("ImportarPipefy", () => {
  it("erro do upload aparece com a mensagem do servidor (e ref no inesperado)", async () => {
    previsualizar.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "abc123" });
    await enviarArquivo();
    expect(await screen.findByRole("alert")).toHaveTextContent("ref: abc123");
  });

  it("mostra a prévia: números, fases, responsáveis sem usuário, erros", async () => {
    previsualizar.mockResolvedValueOnce({ ok: true, token: T1, expiraEm: "2026-10-26T12:30:00Z", previa: previa() });
    await enviarArquivo();
    expect(await screen.findByText(/nada foi gravado ainda/)).toBeInTheDocument();
    expect(screen.getByLabelText("Fase do CRM para Fase misteriosa")).toHaveValue("");
    expect(screen.getByLabelText("Fase do CRM para Lead")).toHaveValue("f-lead");
    expect(screen.getByText("Fulano Externo")).toBeInTheDocument();
    expect(screen.getByText(/sem correspondência no CRM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar import (2 cards)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Baixar erros (CSV)" })).toBeInTheDocument();
  });

  it("mudar o mapeamento bloqueia confirmar até recalcular; recalcular manda o mapa novo", async () => {
    previsualizar.mockResolvedValueOnce({ ok: true, token: T1, expiraEm: "2026-10-26T12:30:00Z", previa: previa() });
    remapear.mockResolvedValueOnce({
      ok: true,
      token: T2,
      expiraEm: "2026-10-26T12:40:00Z",
      previa: previa({ novos: 3, erros: [], fases: [{ chave: "lead", nome: "Lead", cardsAtuais: 2, faseId: "f-lead" }, { chave: "fase misteriosa", nome: "Fase misteriosa", cardsAtuais: 1, faseId: "f-ganho" }] }),
    });
    await enviarArquivo();
    fireEvent.change(await screen.findByLabelText("Fase do CRM para Fase misteriosa"), { target: { value: "f-ganho" } });
    expect(screen.getByRole("button", { name: /Confirmar import/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recalcular prévia" }));
    await waitFor(() => expect(remapear).toHaveBeenCalledWith(T1, { lead: "f-lead", "fase misteriosa": "f-ganho" }));
    expect(await screen.findByRole("button", { name: "Confirmar import (3 cards)" })).toBeEnabled();
  });

  it("confirmar usa token + hash da prévia e mostra o relatório", async () => {
    previsualizar.mockResolvedValueOnce({ ok: true, token: T1, expiraEm: "2026-10-26T12:30:00Z", previa: previa() });
    confirmar.mockResolvedValueOnce({
      ok: true,
      relatorio: { total: 3, criados: 2, atualizados: 0, semMudanca: 0, pulados: 1, duplicadas: 1, projetosCriados: 1, erros: [{ linha: 4, pipefyId: "9", mensagem: "Fase sem correspondência" }], avisos: [] },
    });
    await enviarArquivo();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar import (2 cards)" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Import concluído.");
    expect(confirmar).toHaveBeenCalledWith(T1, "h".repeat(64));
    expect(screen.getByText("Erros por linha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar erros (CSV)" })).toBeInTheDocument();
  });

  it("prévia expirada na confirmação mostra o erro e não sai da prévia", async () => {
    previsualizar.mockResolvedValueOnce({ ok: true, token: T1, expiraEm: "2026-10-26T12:30:00Z", previa: previa() });
    confirmar.mockResolvedValueOnce({ ok: false, erro: "Prévia expirada ou já usada. Envie o arquivo de novo." });
    await enviarArquivo();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar import (2 cards)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Prévia expirada");
  });
});
