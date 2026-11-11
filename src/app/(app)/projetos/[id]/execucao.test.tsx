import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisaoCronograma } from "@/lib/projetos/execucao";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const acoes = vi.hoisted(() => ({
  adicionarEntregaAction: vi.fn(),
  ajustarDataAction: vi.fn(),
  copiarCronogramaAction: vi.fn(),
  desmarcarEntregaAction: vi.fn(),
  marcarEntregaAction: vi.fn(),
  registrarCheckinAction: vi.fn(),
  cancelarEntregaAction: vi.fn(),
}));
vi.mock("./execucao-actions", () => acoes);
const designarGpAction = vi.hoisted(() => vi.fn());
vi.mock("./handoff-actions", () => ({ designarGpAction }));

const { ExecucaoDoProjeto } = await import("./execucao");

const BASE: VisaoCronograma = {
  emExecucao: true,
  gp: { id: "u1", nome: "Pedro" },
  responsavelId: "u1",
  gpDesignado: true,
  isento: false,
  entregas: [
    { id: "e1", titulo: "Diagnóstico", valor: "1000.00", previstoOriginal: "2026-11-20", previsto: "2026-11-27", realizado: null, atrasada: false, origem: "PROPOSTA", propostaVersao: 2, ajustes: [{ de: "2026-11-20", para: "2026-11-27", motivo: "Cliente atrasou", por: "Pedro", em: new Date("2026-11-01T12:00:00Z") }] },
    { id: "e2", titulo: "Final", valor: null, previstoOriginal: "2026-10-01", previsto: "2026-10-01", realizado: "2026-10-02", atrasada: false, origem: "MANUAL", propostaVersao: null, ajustes: [] },
  ],
  canceladas: [],
  checkins: [{ id: "k1", status: "VERMELHO", motivo: "Cliente sumiu", semana: "2026-11-02", por: "Pedro", em: new Date("2026-11-03T12:00:00Z") }],
  checkinNaSemana: true,
  copiaveis: 0,
};

const montar = (extra: Partial<Parameters<typeof ExecucaoDoProjeto>[0]> = {}) => render(<ExecucaoDoProjeto cardId="c1" cronograma={BASE} hoje="2026-11-04" podeOperar podeDesignar={false} candidatosGp={[]} {...extra} />);

beforeEach(() => {
  vi.clearAllMocks();
  for (const a of Object.values(acoes)) a.mockResolvedValue({ ok: true });
  designarGpAction.mockResolvedValue({ ok: true });
});

describe("ExecucaoDoProjeto (GAB-95)", () => {
  it("mostra previsto, original quando ajustou, histórico, feita e último check-in", () => {
    montar();
    expect(screen.getByText(/1 de 2 feitas/)).toBeTruthy();
    expect(screen.getByText(/previsto 27\/11\/2026/).textContent).toContain("original 20/11/2026");
    expect(screen.getByText(/Cliente atrasou/)).toBeTruthy();
    expect(screen.getByText("feita em 02/10/2026")).toBeTruthy();
    expect(screen.getAllByTestId("status-checkin")[0].textContent).toBe("Vermelho");
  });

  it("quem só lê não vê controle nenhum", () => {
    montar({ podeOperar: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Diagnóstico")).toBeTruthy();
  });

  it("quem não opera vê quem opera e como mudar; em registro, não", () => {
    const { rerender } = montar({ podeOperar: false });
    expect(screen.getByText(/Quem opera: Pedro/).textContent).toContain("o PM de projetos designa outro GP");
    rerender(<ExecucaoDoProjeto cardId="c1" cronograma={{ ...BASE, emExecucao: false }} hoje="2026-11-04" podeOperar={false} podeDesignar={false} candidatosGp={[]} />);
    expect(screen.queryByText(/Quem opera/)).toBeNull();
  });

  it("o PM de projetos troca o GP do projeto aqui, sem operar", async () => {
    montar({ podeOperar: false, podeDesignar: true, candidatosGp: [{ id: "u1", nome: "Pedro" }, { id: "u2", nome: "Paula" }] });
    const trocar = screen.getByRole("button", { name: "Trocar GP" }) as HTMLButtonElement;
    expect(trocar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Trocar o GP do projeto"), { target: { value: "u2" } });
    fireEvent.click(trocar);
    await waitFor(() => expect(designarGpAction).toHaveBeenCalledWith("c1", "u2"));
  });

  it("mesma pessoa: libera para formalizar quem não foi designado ou devolver a responsabilidade", () => {
    const cand = [{ id: "u1", nome: "Pedro" }];
    const botao = () => screen.getByRole("button", { name: "Trocar GP" }) as HTMLButtonElement;
    const { rerender } = montar({ podeDesignar: true, candidatosGp: cand });
    expect(botao().disabled).toBe(true);
    const ver = (cronograma: VisaoCronograma) => rerender(<ExecucaoDoProjeto cardId="c1" cronograma={cronograma} hoje="2026-11-04" podeOperar podeDesignar candidatosGp={cand} />);
    ver({ ...BASE, gpDesignado: false });
    expect(botao().disabled).toBe(false);
    ver({ ...BASE, responsavelId: "u9" });
    expect(botao().disabled).toBe(false);
  });

  it("cancelar exige motivo; cancelada fica à parte e fora da conta", async () => {
    const { unmount } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar cancelamento" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento de Diagnóstico"), { target: { value: "Fora do combinado" } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(acoes.cancelarEntregaAction).toHaveBeenCalledWith("c1", "e1", "Fora do combinado"));
    unmount();
    montar({ cronograma: { ...BASE, canceladas: [{ id: "e9", titulo: "Extra", valor: null, previstoOriginal: "2026-12-01", propostaVersao: null, motivo: "Engano", em: new Date("2026-11-01T12:00:00Z") }] } });
    expect(screen.getByText(/1 de 2 feitas/)).toBeTruthy();
    expect(screen.getByText("1 cancelada")).toBeTruthy();
    expect(screen.getByText(/Engano/)).toBeTruthy();
  });

  it("marcar feita manda a data real, padrão hoje", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Marcar feita" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(acoes.marcarEntregaAction).toHaveBeenCalledWith("c1", "e1", "2026-11-04"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("ajustar exige motivo", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar data" }));
    const salvar = screen.getByRole("button", { name: "Salvar ajuste" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Nova data de Diagnóstico"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Motivo do ajuste de Diagnóstico"), { target: { value: "Novo prazo" } });
    fireEvent.click(salvar);
    await waitFor(() => expect(acoes.ajustarDataAction).toHaveBeenCalledWith("c1", "e1", "2026-12-01", "Novo prazo"));
  });

  it("check-in exige cor e motivo", async () => {
    montar();
    const registrar = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(registrar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Amarelo" }));
    expect(registrar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo do check-in"), { target: { value: "Atenção" } });
    fireEvent.click(registrar);
    await waitFor(() => expect(acoes.registrarCheckinAction).toHaveBeenCalledWith("c1", "AMARELO", "Atenção"));
  });

  it("sem entregas: lançar à mão e, se a proposta tiver cronograma, copiar", async () => {
    montar({ cronograma: { ...BASE, entregas: [], copiaveis: 3 } });
    expect(screen.getByText(/A proposta final tem 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copiar da proposta final" }));
    await waitFor(() => expect(acoes.copiarCronogramaAction).toHaveBeenCalledWith("c1"));
    fireEvent.change(screen.getByLabelText("Nome da nova entrega"), { target: { value: "Fase 1" } });
    fireEvent.change(screen.getByLabelText("Data prevista da nova entrega"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(acoes.adicionarEntregaAction).toHaveBeenCalledWith("c1", { titulo: "Fase 1", dia: "2026-12-01", valor: "" }));
  });

  it("erro inesperado mostra a ref", async () => {
    acoes.registrarCheckinAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "abc12345" });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Verde" }));
    fireEvent.change(screen.getByLabelText("Motivo do check-in"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.getByText(/abc12345/)).toBeTruthy());
  });
});
