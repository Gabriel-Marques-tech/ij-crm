import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisaoHandoff } from "@/lib/projetos/handoff";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const acoes = vi.hoisted(() => ({
  designarGpAction: vi.fn(),
  marcarItemAction: vi.fn(),
  salvarResumoAction: vi.fn(),
  definirContratoAction: vi.fn(),
  moverParaExecucaoAction: vi.fn(),
}));
vi.mock("./handoff-actions", () => acoes);
const enviarContratoDoHandoff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projetos/handoff-cliente", () => ({ enviarContratoDoHandoff }));

const { HandoffDoProjeto } = await import("./handoff");

const VAZIO: VisaoHandoff = {
  gp: null,
  gpValido: false,
  responsavelDiverge: false,
  proposta: { congelada: true, dispensada: false, versao: 3 },
  contrato: null,
  itens: { contatos: null, kickoff: null, acessos: null },
  resumo: { contexto: "", combinados: "", riscos: "", valoriza: "" },
  resumoEm: null,
  resumoPor: null,
  pendencias: ["GP", "CONTRATO", "contatos", "kickoff", "acessos", "RESUMO"],
  emHandoff: true,
  isento: false,
  completo: false,
};

function montar(extra: Partial<Parameters<typeof HandoffDoProjeto>[0]> = {}) {
  return render(<HandoffDoProjeto cardId="c1" handoff={VAZIO} somenteLeitura={false} podeDesignar={false} podeResumo={false} candidatosGp={[]} semGpDeProjetos={false} pdfs={[]} {...extra} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const a of Object.values(acoes)) a.mockResolvedValue({ ok: true });
  enviarContratoDoHandoff.mockResolvedValue({ ok: true });
});

describe("HandoffDoProjeto (GAB-93)", () => {
  it("mostra o que falta, trava o botão e a proposta congelada não é clicável", () => {
    montar();
    expect(screen.getByText(/falta: GP do projeto designado/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mover para Execução" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Proposta final congelada") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Proposta final congelada") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/automático, v3/)).toBeTruthy();
  });

  it("completo: move pela action", async () => {
    montar({ handoff: { ...VAZIO, pendencias: [], completo: true } });
    fireEvent.click(screen.getByRole("button", { name: "Mover para Execução" }));
    await waitFor(() => expect(acoes.moverParaExecucaoAction).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("isento: pode mover sem fechar e a tela explica", () => {
    montar({ handoff: { ...VAZIO, isento: true } });
    expect(screen.getByText(/Card anterior a esta etapa/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mover para Execução" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("marca item pela action", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Kickoff marcado"));
    await waitFor(() => expect(acoes.marcarItemAction).toHaveBeenCalledWith("c1", "kickoff", true));
  });

  it("GP: só quem designa vê o seletor", async () => {
    const { unmount } = montar();
    expect(screen.queryByLabelText("GP do projeto")).toBeNull();
    expect(screen.getByText(/Ainda não designado/)).toBeTruthy();
    unmount();
    montar({ podeDesignar: true, candidatosGp: [{ id: "p1", nome: "Pedro" }] });
    fireEvent.change(screen.getByLabelText("GP do projeto"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Designar" }));
    await waitFor(() => expect(acoes.designarGpAction).toHaveBeenCalledWith("c1", "p1"));
  });

  it("resumo: vendas edita e salva; os outros só leem", async () => {
    const { unmount } = montar({ handoff: { ...VAZIO, resumo: { ...VAZIO.resumo, riscos: "Prazo apertado" } } });
    expect(screen.getByText("Prazo apertado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Salvar resumo" })).toBeNull();
    unmount();
    montar({ podeResumo: true });
    expect((screen.getByRole("button", { name: "Salvar resumo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Contexto"), { target: { value: "Padaria" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar resumo" }));
    await waitFor(() => expect(acoes.salvarResumoAction).toHaveBeenCalledWith("c1", { contexto: "Padaria" }));
  });

  it("resumo: o que outra pessoa salvou aparece e não é sobrescrito", async () => {
    const { rerender } = montar({ podeResumo: true });
    fireEvent.change(screen.getByLabelText("Contexto"), { target: { value: "Meu texto" } });
    // Outra pessoa salvou "riscos": o refresh traz o texto dela.
    rerender(<HandoffDoProjeto cardId="c1" handoff={{ ...VAZIO, resumo: { ...VAZIO.resumo, riscos: "Dela" } }} somenteLeitura={false} podeDesignar={false} podeResumo candidatosGp={[]} semGpDeProjetos={false} pdfs={[]} />);
    expect((screen.getByLabelText("Riscos") as HTMLTextAreaElement).value).toBe("Dela");
    expect((screen.getByLabelText("Contexto") as HTMLTextAreaElement).value).toBe("Meu texto");
    fireEvent.click(screen.getByRole("button", { name: "Salvar resumo" }));
    await waitFor(() => expect(acoes.salvarResumoAction).toHaveBeenCalledWith("c1", { contexto: "Meu texto" }));
  });

  it("GP divergente do responsável: avisa e habilita Designar para a mesma pessoa", async () => {
    const gp = { id: "p1", nome: "Pedro" };
    const { unmount } = montar({ podeDesignar: true, candidatosGp: [gp], handoff: { ...VAZIO, gp, gpValido: true } });
    expect((screen.getByRole("button", { name: "Designar" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    montar({ podeDesignar: true, candidatosGp: [gp], handoff: { ...VAZIO, gp, gpValido: true, responsavelDiverge: true } });
    expect(screen.getByText(/não é mais o GP/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Designar" }));
    await waitFor(() => expect(acoes.designarGpAction).toHaveBeenCalledWith("c1", "p1"));
  });

  it("GP que não vale mais: avisa e pede outro", () => {
    const gp = { id: "p1", nome: "Pedro" };
    montar({ podeDesignar: true, handoff: { ...VAZIO, gp, gpValido: false } });
    expect(screen.getByText(/não está mais ativa na área de projetos/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Pedro (não pode mais ser GP)" })).toBeTruthy();
  });

  it("sem PM de projetos: diz que ninguém tem o cargo e pede à gestão", () => {
    montar({ semGpDeProjetos: true });
    expect(screen.getByText(/Ninguém tem o cargo de PM de projetos.*Peça à gestão/)).toBeTruthy();
  });

  it("PDF: envia arquivo ou aponta um já anexado", async () => {
    montar({ pdfs: [{ id: "a1", nome: "assinado.pdf" }] });
    const arquivo = new File(["%PDF"], "c.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Anexar PDF do contrato"), { target: { files: [arquivo] } });
    await waitFor(() => expect(enviarContratoDoHandoff).toHaveBeenCalledWith("c1", arquivo));
    fireEvent.change(screen.getByLabelText("PDF já anexado"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "É este" }));
    await waitFor(() => expect(acoes.definirContratoAction).toHaveBeenCalledWith("c1", "a1"));
  });

  it("erro inesperado mostra a ref", async () => {
    acoes.marcarItemAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "abc12345" });
    montar();
    fireEvent.click(screen.getByLabelText("Contatos do cliente"));
    expect(await screen.findByText("abc12345")).toBeTruthy();
  });

  it("visualizador e fora da coluna: nada editável", () => {
    const { unmount } = montar({ somenteLeitura: true, podeDesignar: true, podeResumo: true });
    expect(screen.queryByRole("button", { name: "Mover para Execução" })).toBeNull();
    expect((screen.getByLabelText("Kickoff marcado") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Anexar PDF" })).toBeNull();
    unmount();
    montar({ handoff: { ...VAZIO, emHandoff: false, pendencias: [], completo: true }, podeResumo: true });
    expect(screen.queryByRole("button", { name: "Salvar resumo" })).toBeNull();
    expect((screen.getByLabelText("Kickoff marcado") as HTMLInputElement).disabled).toBe(true);
  });
});
