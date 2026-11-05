import { act, fireEvent, render, screen } from "@testing-library/react";
import { useImperativeHandle, type ReactNode, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControleEditor } from "@/components/propostas/editor-texto";
import type { Documento } from "@/lib/propostas/documento";

const acoes = vi.hoisted(() => ({
  salvarTextoAction: vi.fn(),
  salvarEstruturadoAction: vi.fn(),
  salvarVersaoAction: vi.fn(),
  criarPropostaAction: vi.fn(),
  passarCanetaAction: vi.fn(),
  devolverAction: vi.fn(),
  concordarAction: vi.fn(),
  pegarCanetaAction: vi.fn(),
  reabrirAction: vi.fn(),
  marcarInviavelAction: vi.fn(),
  marcarEnviadaAction: vi.fn(),
  registrarRespostaAction: vi.fn(),
  concluirRevisaoAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
const substituido = vi.hoisted(() => ({ doc: null as unknown }));

vi.mock("./actions", () => acoes);
vi.mock("./preencher-actions", () => ({ sugerirDeAnexoAction: vi.fn() }));
vi.mock("./comentarios-actions", () => ({ comentarAction: vi.fn(), responderComentarioAction: vi.fn(), resolverComentarioAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// Editor falso (o Tiptap de verdade é testado em editor-texto.test): textarea → documento de um parágrafo.
vi.mock("next/dynamic", () => ({
  default: () =>
    function EditorFalso({ aoMudar, controle, barraFim }: { aoMudar: (d: Documento) => void; controle?: Ref<ControleEditor>; barraFim?: ReactNode }) {
      const doc = (t: string): Documento => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
      let atual = doc("inicial");
      useImperativeHandle(controle, () => ({ documento: () => atual, substituir: (d) => (substituido.doc = d) }));
      return (
        <>
          {barraFim}
          <textarea
            aria-label="texto"
            onChange={(e) => {
              atual = doc(e.target.value);
              aoMudar(atual);
            }}
          />
        </>
      );
    },
}));

const { PainelProposta } = await import("./painel-proposta");

const vazio = { valor: "", prazoDias: "", escopoResumo: "", entregas: [] };
const montar = () =>
  render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={null} />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("PainelProposta", () => {
  it("autosave manda o texto com a revisão e mostra 'salvo'", async () => {
    acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 5 });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "olá" } });
    expect(screen.getByText("Alterações não salvas…")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(acoes.salvarTextoAction).toHaveBeenCalledWith("p1", 4, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "olá" }] }] });
    expect(screen.getByText(/Salvo há \d+ s/)).toBeInTheDocument();
  });

  it("conflito: avisa quem mexeu, não grava de novo sozinho, e deixa escolher", async () => {
    const docServidor = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "do Claude" }] }] };
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "conflito",
      conflito: { revisao: 7, por: "Gil", viaMcp: true, em: null, documento: docServidor, estruturado: vazio },
    });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("alert")).toHaveTextContent(/alterada em outro lugar por Gil \(via MCP\)/);
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu 2" } });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(1);

    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Manter o meu texto e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 7, expect.objectContaining({ type: "doc" }));
    expect(screen.queryByText(/alterada em outro lugar/)).toBeNull();
  });

  it("conflito → 'carregar a versão atual' troca o texto do editor pelo do servidor", async () => {
    const docServidor = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "do servidor" }] }] };
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: false, erro: "c", conflito: { revisao: 9, por: null, viaMcp: false, em: null, documento: docServidor, estruturado: vazio } });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    fireEvent.click(screen.getByRole("button", { name: /Carregar a versão atual/ }));
    expect(substituido.doc).toEqual(docServidor);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro inesperado mostra a ref do log e 'tentar de novo'", async () => {
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "a1b2c3d4" });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar. Erro no servidor. (ref: a1b2c3d4)");
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(2);
  });

  it("versão que falhou: 'tentar de novo' repete a versão, e o aviso não some até lá", async () => {
    acoes.salvarVersaoAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "a1b2c3d4" });
    montar();
    fireEvent.change(screen.getByLabelText("Nota da versão (opcional)"), { target: { value: "primeira" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("alert")).toHaveTextContent("ref: a1b2c3d4");
    expect(screen.getByText("A versão não foi salva.")).toBeInTheDocument();
    expect(screen.queryByText("Rascunho salvo")).toBeNull();

    acoes.salvarVersaoAction.mockResolvedValueOnce({ ok: true, revisao: 4, numero: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarVersaoAction).toHaveBeenCalledTimes(2);
    expect(acoes.salvarVersaoAction).toHaveBeenLastCalledWith("p1", 4, { documento: expect.objectContaining({ type: "doc" }), nota: "primeira" });
    expect(screen.getByText("Versão v1 salva.")).toBeInTheDocument();
    expect(screen.queryByText("A versão não foi salva.")).toBeNull();
  });

  it("versão que caiu por falta de rede também avisa e repete", async () => {
    acoes.salvarVersaoAction.mockRejectedValueOnce(new Error("rede"));
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("A versão não foi salva.")).toBeInTheDocument();
    acoes.salvarVersaoAction.mockResolvedValueOnce({ ok: true, revisao: 4, numero: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Versão v1 salva.")).toBeInTheDocument();
  });

  it("versão que falhou e texto gravado depois: o aviso fica até a próxima tentativa, e 'tentar de novo' volta a ser só do texto", async () => {
    acoes.salvarVersaoAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "a1b2c3d4" });
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 5 });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "novo" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByText("A versão não foi salva.")).toBeInTheDocument();

    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "b2" });
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "mais" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 6 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarVersaoAction).toHaveBeenCalledTimes(1);
    expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(3);
  });

  it("salvar versão manda o texto do editor e a nota; mostra o número", async () => {
    acoes.salvarVersaoAction.mockResolvedValue({ ok: true, revisao: 4, numero: 1 });
    montar();
    fireEvent.change(screen.getByLabelText("Nota da versão (opcional)"), { target: { value: "primeira" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarVersaoAction).toHaveBeenCalledWith("p1", 4, { documento: expect.objectContaining({ type: "doc" }), nota: "primeira" });
    expect(screen.getByText("Versão v1 salva.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("manter o meu texto: dados sem alteração local passam a ser os do servidor (a próxima gravação não desfaz a mudança do outro)", async () => {
    const dadosServidor = { valor: "25.000,00", prazoDias: "", escopoResumo: "", entregas: [] };
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "c",
      conflito: { revisao: 6, por: "Gil", viaMcp: true, em: null, documento: { type: "doc", content: [] }, estruturado: dadosServidor },
    });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Manter o meu texto e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByPlaceholderText("ex.: 12.500,00")).toHaveValue("25.000,00");
    expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();

    acoes.salvarEstruturadoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "30" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 7, expect.objectContaining({ valor: "25.000,00", prazoDias: "30" }));
  });

  it("manter os meus com dados alterados aqui: a escolha avisa e grava texto e dados por cima", async () => {
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "c",
      conflito: { revisao: 6, por: "Gil", viaMcp: false, em: null, documento: { type: "doc", content: [] }, estruturado: { ...vazio, valor: "25.000,00" } },
    });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    // Com o conflito aberto, nada grava sozinho: nem o texto, nem os dados.
    fireEvent.change(screen.getByPlaceholderText("ex.: 12.500,00"), { target: { value: "30.000,00" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 7 });
    acoes.salvarEstruturadoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Manter os meus (texto e dados) e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 6, expect.anything());
    expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 7, expect.objectContaining({ valor: "30.000,00" }));
  });

  describe("cartão Dados da proposta (GAB-100)", () => {
    it("enquanto está sujo, a barra diz que há alterações não salvas, inclusive com linha incompleta", async () => {
      montar();
      fireEvent.click(screen.getByRole("button", { name: "Adicionar entrega" }));
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(screen.getByText("Alterações não salvas…")).toBeInTheDocument();
    });

    it("ao sair da tela grava o que está sujo e válido, deixando de fora só a linha incompleta", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      const { unmount } = montar();
      fireEvent.change(screen.getByPlaceholderText("ex.: 12.500,00"), { target: { value: "5.000,00" } });
      fireEvent.click(screen.getByRole("button", { name: "Adicionar entrega" }));
      unmount();
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledTimes(1);
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, expect.objectContaining({ valor: "5.000,00", entregas: [] }));
    });

    describe("sair da tela nunca apaga entrega gravada (re-revisão)", () => {
      const linha = (titulo: string) => ({ titulo, dia: "2027-01-10", duracao: "", valor: "" });
      const salvas = [linha("A"), linha("B"), linha("C")];
      const montarSalvas = () => render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} ultimaVersao={null} estruturado={{ ...vazio, entregas: salvas }} />);
      const nova = (n: number, titulo: string) => {
        fireEvent.click(screen.getByRole("button", { name: "Adicionar entrega" }));
        fireEvent.change(screen.getByLabelText(`Entrega ${n}: nome`), { target: { value: titulo } });
        fireEvent.change(screen.getByLabelText(`Entrega ${n}: duração`), { target: { value: "1 semana" } });
      };
      const linhaNova = (titulo: string) => ({ titulo, dia: "", duracao: "1 semana", valor: "" });
      const limparData = (n: number) => fireEvent.change(screen.getByLabelText(`Entrega ${n}: data`), { target: { value: "" } });

      it("B incompleta + D nova: as três gravadas continuam, a D entra, e o valor válido vai", async () => {
        acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
        const { unmount } = montarSalvas();
        fireEvent.change(screen.getByPlaceholderText("ex.: 12.500,00"), { target: { value: "5.000,00" } });
        limparData(2);
        nova(4, "D");
        unmount();
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(acoes.salvarEstruturadoAction).toHaveBeenCalledTimes(1);
        expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, { ...vazio, valor: "5.000,00", entregas: [...salvas, linhaNova("D")] });
      });

      it("A e C incompletas com D e E novas: as gravadas ficam como estavam e as novas entram", async () => {
        acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
        const { unmount } = montarSalvas();
        limparData(1);
        limparData(3);
        nova(4, "D");
        nova(5, "E");
        unmount();
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, { ...vazio, entregas: [...salvas, linhaNova("D"), linhaNova("E")] });
      });

      it("linha nova já gravada deixa de ser nova: incompleta depois, não é descartada", async () => {
        acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
        const { unmount } = montarSalvas();
        nova(4, "D");
        await act(() => vi.advanceTimersByTimeAsync(1500));
        const gravado = acoes.salvarEstruturadoAction.mock.calls[0][2];
        expect(gravado.entregas[3]).toEqual({ titulo: "D", dia: "", duracao: "1 semana", valor: "" });
        fireEvent.change(screen.getByLabelText("Entrega 4: duração"), { target: { value: "" } });
        unmount();
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(acoes.salvarEstruturadoAction).toHaveBeenCalledTimes(1);
      });

      it("gravação que falha ao sair não muda o `salvo`; marca de edição nunca vai no payload", async () => {
        acoes.salvarEstruturadoAction.mockResolvedValue({ ok: false, erro: "falhou" });
        montarSalvas();
        nova(4, "D");
        await act(() => vi.advanceTimersByTimeAsync(1500));
        expect(JSON.stringify(acoes.salvarEstruturadoAction.mock.calls)).not.toContain("chaveNova");
      });

      it("marcar inviável com B incompleta e D nova mantém as gravadas", async () => {
        acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
        acoes.marcarInviavelAction.mockResolvedValue({ ok: true, revisao: 6 });
        const caneta = { acoes: ["inviavel"] as "inviavel"[], mesmoLado: [], outroLado: [], rotuloOutroLado: "Vendas" };
        render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} ultimaVersao={1} estruturado={{ ...vazio, entregas: salvas }} caneta={caneta} />);
        fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "30" } });
        limparData(2);
        nova(4, "D");
        fireEvent.click(screen.getByRole("button", { name: "Marcar inviável" }));
        fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "sem verba" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Marcar inviável" }).at(-1)!);
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, { ...vazio, prazoDias: "30", entregas: [...salvas, linhaNova("D")] });
        expect(acoes.marcarInviavelAction).toHaveBeenCalled();
      });
    });

    it("sair sem nada sujo não grava", async () => {
      const { unmount } = montar();
      unmount();
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();
      expect(acoes.salvarTextoAction).not.toHaveBeenCalled();
    });

    it("parcelas e durações que não fecham: avisa no cartão, sem travar a gravação", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} ultimaVersao={null} estruturado={{ valor: "1.000,00", prazoDias: "30", escopoResumo: "", entregas: [{ titulo: "A", dia: "", duracao: "1 semana", valor: "400,00" }] }} />);
      const avisos = screen.getByRole("list", { name: "Avisos dos dados" });
      expect(avisos).toHaveTextContent(/parcelas somam R\$ 400,00/);
      expect(avisos).toHaveTextContent(/durações somam 7 dias/);
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "31" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalled();
    });

    it("com duração no cronograma não há 'ordenar por data': a sequência é a conta", () => {
      const e = (o: object) => ({ titulo: "A", dia: "2026-01-01", duracao: "", valor: "", ...o });
      const { unmount } = render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} ultimaVersao={null} estruturado={{ ...vazio, entregas: [e({}), e({})] }} />);
      expect(screen.getByRole("button", { name: /Ordenar por data/ })).toBeInTheDocument();
      unmount();
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} ultimaVersao={null} estruturado={{ ...vazio, entregas: [e({}), e({ dia: "", duracao: "2 semanas" })] }} />);
      expect(screen.queryByRole("button", { name: /Ordenar por data/ })).toBeNull();
    });

    it("salvar versão sem mudança informa, sem virar erro de gravação, e não bloqueia as ações", async () => {
      acoes.salvarVersaoAction.mockResolvedValue({ ok: false, erro: "Nada mudou desde a última versão: não há o que salvar.", semMudancas: true });
      acoes.passarCanetaAction.mockResolvedValue({ ok: true, revisao: 9 });
      const caneta = { acoes: ["passar"] as "passar"[], mesmoLado: [{ id: "bia", nome: "Bia" }], outroLado: [], rotuloOutroLado: "Projetos" };
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={1} caneta={caneta} />);
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText(/Nada mudou desde a última versão/)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.passarCanetaAction).toHaveBeenCalled();
    });

    it("marcar inviável não exige dados válidos: grava só o que dá", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      acoes.marcarInviavelAction.mockResolvedValue({ ok: true, revisao: 6 });
      const caneta = { acoes: ["inviavel"] as "inviavel"[], mesmoLado: [], outroLado: [], rotuloOutroLado: "Vendas" };
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={1} caneta={caneta} />);
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "abc" } });
      fireEvent.click(screen.getByRole("button", { name: "Marcar inviável" }));
      fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "sem verba" } });
      fireEvent.click(screen.getAllByRole("button", { name: "Marcar inviável" }).at(-1)!);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.marcarInviavelAction).toHaveBeenCalledWith("p1", "sem verba");
      expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();
    });

    it("Ver PDF com o texto em erro avisa que a prévia é do último rascunho salvo", async () => {
      const aba = { location: { href: "" } };
      vi.spyOn(window, "open").mockReturnValue(aba as unknown as Window);
      acoes.salvarTextoAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "a1" });
      montar();
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Ver PDF" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText(/O PDF mostra o último rascunho salvo/)).toBeInTheDocument();
      expect(aba.location.href).toContain("rascunho=1");
    });

    it("salva sozinho pela mesma revisão, sem botão e sem travar o campo enquanto grava", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      montar();
      expect(screen.queryByRole("button", { name: "Salvar dados" })).toBeNull();
      const valor = screen.getByPlaceholderText("ex.: 12.500,00");
      fireEvent.change(valor, { target: { value: "12.500,00" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledTimes(1);
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, expect.objectContaining({ valor: "12.500,00" }));
      expect(valor.closest("fieldset")).not.toBeDisabled();
      // A próxima gravação usa a revisão que a anterior devolveu.
      acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 6 });
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarTextoAction).toHaveBeenCalledWith("p1", 5, expect.anything());
    });

    it("dado incompleto não vai para o servidor: fica no cartão com o motivo e salva quando completar", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      montar();
      fireEvent.click(screen.getByRole("button", { name: "Adicionar entrega" }));
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(/Ainda não salvo: Entrega 1: dê um nome/);
      fireEvent.change(screen.getByLabelText("Entrega 1: nome"), { target: { value: "Levantamento" } });
      fireEvent.change(screen.getByLabelText("Entrega 1: duração"), { target: { value: "2 semanas" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, expect.objectContaining({ entregas: [{ titulo: "Levantamento", dia: "", duracao: "2 semanas", valor: "" }] }));
    });

    it("mudou de novo enquanto gravava: continua sujo e grava a versão mais nova", async () => {
      let terminar: (r: unknown) => void = () => undefined;
      acoes.salvarEstruturadoAction.mockImplementationOnce(() => new Promise((res) => (terminar = res))).mockResolvedValue({ ok: true, revisao: 6 });
      montar();
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "30" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "31" } });
      await act(async () => terminar({ ok: true, revisao: 5 }));
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarEstruturadoAction).toHaveBeenLastCalledWith("p1", 5, expect.objectContaining({ prazoDias: "31" }));
    });

    it("documento que só mudou no que o Markdown não guarda não agenda gravação (abrir a folha não é editar)", async () => {
      montar();
      // O editor falso manda o mesmo documento vazio que a página abriu: parágrafo vazio não vai para o Markdown.
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarTextoAction).not.toHaveBeenCalled();
    });

    it("passar a caneta grava antes os dados pendentes; incompleto segura a ação", async () => {
      acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
      acoes.passarCanetaAction.mockResolvedValue({ ok: true, revisao: 6 });
      const caneta = { acoes: ["passar"] as "passar"[], mesmoLado: [{ id: "bia", nome: "Bia" }], outroLado: [], rotuloOutroLado: "Projetos" };
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={1} caneta={caneta} />);
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "abc" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.passarCanetaAction).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/Dados da proposta: Prazo inválido/);

      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, expect.objectContaining({ prazoDias: "30" }));
      expect(acoes.passarCanetaAction).toHaveBeenCalledWith("p1", "bia");
    });
  });

  describe("caneta (GAB-87)", () => {
    const caneta = { acoes: ["passar", "devolver", "concordar"] as ("passar" | "devolver" | "concordar")[], mesmoLado: [{ id: "bia", nome: "Bia" }], outroLado: [{ id: "paula", nome: "Paula" }], rotuloOutroLado: "Projetos" };
    const montarComCaneta = () =>
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={1} caneta={caneta} />);

    it("devolver grava o pendente antes e manda o editor, a pessoa e a nota com a revisão nova", async () => {
      acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 5 });
      acoes.devolverAction.mockResolvedValue({ ok: true });
      montarComCaneta();
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "minha parte" } });
      fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
      fireEvent.change(screen.getByLabelText("Devolver para (projetos)"), { target: { value: "paula" } });
      fireEvent.change(screen.getAllByLabelText("Nota da versão (opcional)")[1], { target: { value: "vejam o escopo" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão e devolver" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(1);
      expect(acoes.devolverAction).toHaveBeenCalledWith("p1", 5, {
        paraId: "paula",
        // (o editor falso volta ao texto inicial a cada render; o que importa é ir o documento do editor)
        documento: expect.objectContaining({ type: "doc" }),
        estruturado: undefined,
        nota: "vejam o escopo",
      });
      expect(refresh).toHaveBeenCalled();
    });

    it("concordar com dados alterados e não salvos é barrado na tela; recusa do servidor aparece com o texto dela", async () => {
      montarComCaneta();
      fireEvent.change(screen.getByPlaceholderText("ex.: 60"), { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: "Concordar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.concordarAction).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/dados da proposta alterados/);
    });

    it("erro inesperado de uma ação da caneta mostra a ref", async () => {
      acoes.passarCanetaAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "beef0001" });
      montarComCaneta();
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.passarCanetaAction).toHaveBeenCalledWith("p1", "bia");
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível passar a caneta. Erro no servidor. (ref: beef0001)");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("ação de caneta devolve a revisão nova e o editor a adota (sem conflito falso na próxima digitação)", async () => {
      acoes.passarCanetaAction.mockResolvedValue({ ok: true, revisao: 9 });
      acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 10 });
      montarComCaneta();
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "depois" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 9, expect.anything());
    });
  });

  it("aplicar sugestão de arquivo (GAB-90): texto no editor e dados mesclados, gravados pelas actions de sempre", async () => {
    acoes.salvarEstruturadoAction.mockResolvedValue({ ok: true, revisao: 5 });
    acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 6 });
    const { sugerirDeAnexoAction } = await import("./preencher-actions");
    const doc: Documento = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "do arquivo" }] }] };
    vi.mocked(sugerirDeAnexoAction).mockResolvedValue({
      ok: true,
      sugestao: { origem: "texto", anexo: { id: "a".repeat(32), nome: "p.pdf" }, documento: doc, campos: { valor: "9.000,00", prazoDias: null, escopoResumo: null, entregas: null }, revisar: [] },
    });
    render(
      <PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={{ ...vazio, prazoDias: "30" }} ultimaVersao={null} anexos={[{ id: "a".repeat(32), nome: "p.pdf", tipo: "PDF", semTexto: false }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Usar arquivo como base/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ler arquivo" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar ao rascunho" })));
    expect(substituido.doc).toEqual(doc);
    expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 4, { ...vazio, valor: "9.000,00", prazoDias: "30" });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(acoes.salvarTextoAction).toHaveBeenCalledWith("p1", 5, doc);
  });
});
