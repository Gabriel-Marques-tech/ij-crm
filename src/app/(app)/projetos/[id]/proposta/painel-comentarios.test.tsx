import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Documento } from "@/lib/propostas/documento";

const acoes = vi.hoisted(() => ({ comentarAction: vi.fn(), responderComentarioAction: vi.fn(), resolverComentarioAction: vi.fn(), enviarRevisaoAction: vi.fn(), descartarPendenteAction: vi.fn() }));
vi.mock("./comentarios-actions", () => acoes);

const { ATRASO_TEXTO_MS, BotaoComentarTrecho, ComentariosProvider, INTERVALO_COMENTARIOS_MS, SESSAO_EXPIRADA, TextoComentavel, useComentarios } = await import("./comentarios-contexto");
const { PainelComentarios } = await import("./painel-comentarios");

const doc: Documento = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo de 30 dias para o site." }] }] };

const thread = (over: object = {}) => ({
  id: "c1",
  autor: { id: "u2", nome: "Paula" },
  texto: "30 é pouco <b>mesmo</b>",
  criadoEm: "2026-11-03T12:00:00.000Z",
  viaMcp: false,
  pendente: false,
  campo: null,
  sugestao: null,
  ancora: { trecho: "30 dias", antes: "Prazo de ", depois: " para o site." },
  trechoAlterado: false,
  resolvido: null,
  respostas: [],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const resposta = (corpo: object, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status }));

function montar(threads = [thread()], documento = doc) {
  return render(
    <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads }}>
      <BotaoComentarTrecho />
      <TextoComentavel documento={documento} />
      <PainelComentarios />
    </ComentariosProvider>,
  );
}

function ocultar(oculta: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculta });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchMock = vi.fn(() => resposta({ versao: "1.1" }));
  vi.stubGlobal("fetch", fetchMock);
  ocultar(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("comentários ao vivo", () => {
  it("mostra a thread com o trecho e realça o trecho no texto; HTML do comentário sai como texto", () => {
    montar();
    expect(screen.getByText("30 é pouco <b>mesmo</b>")).toBeTruthy();
    expect([...document.querySelectorAll("b")].some((b) => b.textContent === "mesmo")).toBe(false);
    expect(document.querySelector("mark[data-comentario='c1']")?.textContent).toBe("30 dias");
    expect(screen.queryByText("desatualizado")).toBeNull();
  });

  it("trecho que não está mais no texto: 'trecho alterado', sem realce, comentário visível", () => {
    montar([thread()], { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo de 45 dias." }] }] });
    expect(screen.getByText("desatualizado")).toBeTruthy();
    expect(document.querySelector("mark")).toBeNull();
    expect(screen.getByText("30 é pouco <b>mesmo</b>")).toBeTruthy();
  });

  it("polling a cada 5 s com a versão; comentário novo aparece sozinho; pausa com a aba oculta", async () => {
    montar([]);
    expect(screen.getByText("Nenhum comentário ainda.")).toBeTruthy();
    fetchMock.mockImplementationOnce(() => resposta({ versao: "2.2", comentarios: [thread({ texto: "Novo da Paula" })] }));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenCalledWith("/api/projetos/p1/comentarios?v=1.1", { cache: "no-store" });
    expect(screen.getByText("Novo da Paula")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/projetos/p1/comentarios?v=2.2", { cache: "no-store" });
    const n = fetchMock.mock.calls.length;
    act(() => ocultar(true));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 4));
    expect(fetchMock.mock.calls.length).toBe(n);
    await act(async () => ocultar(false)); // volta: consulta na hora
    expect(fetchMock.mock.calls.length).toBe(n + 1);
  });

  it("erro do servidor no polling mostra a ref do log", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Erro no servidor.", ref: "abcd1234" }, 500));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toContain("ref: abcd1234");
  });

  it("comentário geral: chama a action e recarrega; erro inesperado mostra a ref", async () => {
    montar([]);
    acoes.comentarAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "f00dbabe" });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "Faltou o valor" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "Faltou o valor", null, { pendente: false });
    expect(screen.getByRole("alert").textContent).toContain("ref: f00dbabe");

    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" })));
    expect(fetchMock).toHaveBeenCalled();
    expect((screen.getByLabelText("Comentário geral") as HTMLTextAreaElement).value).toBe("");
  });

  it("'Comentar trecho' cita a seleção do texto; sem seleção, explica", async () => {
    montar([]);
    fireEvent.click(screen.getByRole("button", { name: /Comentar trecho/ }));
    expect(screen.getByRole("status").textContent).toMatch(/Selecione um trecho/);

    const no = document.querySelector("[data-o]")!.firstChild!;
    const r = document.createRange();
    r.setStart(no, 9);
    r.setEnd(no, 16);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    fireEvent.click(screen.getByRole("button", { name: /Comentar trecho/ }));
    expect(screen.getByText("“30 dias”")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Comentário sobre o trecho"), { target: { value: "pouco" } });
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "pouco", { trecho: "30 dias", antes: "Prazo de ", depois: " para o site.\n\uE001\n\uE002" }, { pendente: false });
  });

  it("resolver, reabrir e responder chamam as actions", async () => {
    montar([thread(), thread({ id: "c2", ancora: null, texto: "geral", resolvido: { por: "Ana", em: "2026-11-03T13:00:00.000Z" } })]);
    acoes.resolverComentarioAction.mockResolvedValue({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resolver" })));
    expect(acoes.resolverComentarioAction).toHaveBeenCalledWith("c1", true);

    // Resolvida vira linha fina: o texto da conversa só aparece ao abrir.
    expect(screen.queryByText("geral")).toBeNull();
    expect(screen.getByText("Resolvido por Ana")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reabrir" })));
    expect(acoes.resolverComentarioAction).toHaveBeenCalledWith("c2", false);
    fireEvent.click(screen.getByRole("button", { name: /Ver a conversa/ }));
    expect(screen.getAllByText("geral").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.queryByText("geral")).toBeNull();

    acoes.responderComentarioAction.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Responder" })[0]);
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "concordo" } });
    await act(async () => fireEvent.submit(screen.getByLabelText("Sua resposta").closest("form")!));
    expect(acoes.responderComentarioAction).toHaveBeenCalledWith("c1", "concordo", false);
  });

  it("401: para o polling e pede para recarregar", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Sessão expirada." }, 401));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toBe(SESSAO_EXPIRADA);
    const n = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 3));
    await act(async () => ocultar(false));
    expect(fetchMock.mock.calls.length).toBe(n);
  });

  it("respostas fora de ordem: a velha (polling) que chega depois da recarga pós-ação é descartada", async () => {
    montar([]);
    let soltarVelha: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (soltarVelha = ok)));
    fetchMock.mockImplementationOnce(() => resposta({ versao: "3.3", comentarios: [thread({ texto: "Novo" })] }));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS)); // polling (fica pendurado)
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" }))); // recarga chega
    expect(screen.getByText("Novo")).toBeTruthy();
    await act(async () => soltarVelha(new Response(JSON.stringify({ versao: "2.2", comentarios: [] }))));
    expect(screen.getByText("Novo")).toBeTruthy();
  });

  it("rede lenta (> 5 s): o tick não empilha requisição; a resposta lenta atualiza a tela", async () => {
    montar([]);
    let soltar: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (soltar = ok)));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 3)); // ainda pendurada
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => soltar(new Response(JSON.stringify({ versao: "2.2", comentarios: [thread({ texto: "Chegou devagar" })] }))));
    expect(screen.getByText("Chegou devagar")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("depois do 401, uma recarga ok (após uma ação) limpa o aviso e retoma o polling", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Sessão expirada." }, 401));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toBe(SESSAO_EXPIRADA);
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" })));
    expect(screen.queryByText(SESSAO_EXPIRADA)).toBeNull();
    const n = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock.mock.calls.length).toBe(n + 1);
  });

  it("texto do editor: 'trecho alterado' recalculado com pausa e no formato canônico (dois espaços acham o trecho)", async () => {
    let informar: ((d: Documento) => void) | undefined;
    function Fonte() {
      informar = useComentarios()!.informarTexto;
      return null;
    }
    const p = (t: string): Documento => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <Fonte />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    act(() => informar!(p("Prazo de  30   dias para o site."))); // 1ª vez: na hora; espaços extras não importam
    expect(screen.queryByText("desatualizado")).toBeNull();
    act(() => informar!(p("Prazo de 45 dias.")));
    expect(screen.queryByText("desatualizado")).toBeNull(); // ainda na pausa
    await act(async () => vi.advanceTimersByTimeAsync(ATRASO_TEXTO_MS));
    expect(screen.getByText("desatualizado")).toBeTruthy();
  });

  it("rascunho e resposta sobrevivem a fechar o painel no celular (o provider guarda)", () => {
    const Tela = ({ aberto }: { aberto: boolean }) => (
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <TextoComentavel documento={doc} />
        {aberto ? <PainelComentarios /> : null}
      </ComentariosProvider>
    );
    const { rerender } = render(<Tela aberto />);
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "quase pronto" } });
    fireEvent.click(screen.getByRole("button", { name: /Responder/ }));
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "minha resposta" } });
    rerender(<Tela aberto={false} />);
    rerender(<Tela aberto />);
    expect(screen.getByLabelText("Comentário geral")).toHaveValue("quase pronto");
    expect(screen.getByLabelText("Sua resposta")).toHaveValue("minha resposta");
  });

  it("trecho citado de um bloco aparece pelo título; o caractere reservado não vaza", () => {
    montar([thread({ ancora: { trecho: "\uE001", antes: "", depois: "" } })], { type: "doc", content: [{ type: "blocoDados", attrs: { tipo: "cronograma" } }] });
    expect(screen.getByText("“Cronograma”")).toBeTruthy();
  });

  it("tocar num trecho destacado pede para abrir o painel (celular)", () => {
    const Pedido = () => <output data-testid="pedido">{useComentarios()?.pedidoPainel}</output>;
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <TextoComentavel documento={doc} />
        <Pedido />
      </ComentariosProvider>,
    );
    fireEvent.click(document.querySelector("mark[data-comentario='c1']")!);
    expect(screen.getByTestId("pedido")).toHaveTextContent("1");
  });

  it("foco no campo só em citação nova: reabrir o painel não foca de novo", () => {
    let citar: ((a: { trecho: string; antes: string; depois: string }) => void) | undefined;
    const Citador = () => {
      citar = useComentarios()?.citar;
      return null;
    };
    const Tela = ({ aberto }: { aberto: boolean }) => (
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
        <Citador />
        {aberto ? <PainelComentarios /> : null}
      </ComentariosProvider>
    );
    const { rerender } = render(<Tela aberto={false} />);
    act(() => citar!({ trecho: "x", antes: "", depois: "" }));
    rerender(<Tela aberto />);
    const campo = screen.getByLabelText("Comentário sobre o trecho");
    expect(document.activeElement).toBe(campo);
    rerender(<Tela aberto={false} />);
    (document.activeElement as HTMLElement | null)?.blur?.();
    rerender(<Tela aberto />);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Comentário sobre o trecho"));
  });

  it("toque em trecho dentro do editor não pede para abrir o painel", () => {
    const Pedido = () => <output data-testid="pedido">{useComentarios()?.pedidoPainel}</output>;
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
        <div className="ProseMirror">
          <span data-comentario="c1">trecho</span>
        </div>
        <Pedido />
      </ComentariosProvider>,
    );
    fireEvent.click(screen.getByText("trecho"));
    expect(screen.getByTestId("pedido")).toHaveTextContent("0");
  });

  it("sugestão: diff no cartão; sem a caneta, explica; com a caneta, aplica pelo aplicador", async () => {
    const sug = thread({ sugestao: { texto: "45 dias", aplicada: null, desatualizada: false } });
    montar([sug]);
    expect(screen.getByTestId("diff-texto").textContent).toContain("45");
    expect(screen.getByText("Só quem está com a caneta aplica.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aplicar sugestão" })).toBeNull();
  });

  it("aplicar chama o aplicador da tela e mostra o erro dele", async () => {
    const sug = thread({ sugestao: { texto: "45 dias", aplicada: null, desatualizada: false } });
    const aplicador = vi.fn(async () => "Deu conflito");
    const Registra = () => {
      const r = useComentarios()!.registrarAplicador;
      useEffect(() => r(aplicador), [r]);
      return null;
    };
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [sug] }}>
        <Registra />
        <TextoComentavel documento={doc} />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Aplicar sugestão" })));
    expect(aplicador).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(screen.getByRole("alert").textContent).toBe("Deu conflito");
  });

  it("trecho mudado: sugestão desatualizada, sem botão de aplicar", () => {
    const sug = thread({ sugestao: { texto: "45 dias", aplicada: null, desatualizada: true } });
    const Registra = () => {
      const r = useComentarios()!.registrarAplicador;
      useEffect(() => r(async () => null), [r]);
      return null;
    };
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [sug] }}>
        <Registra />
        <TextoComentavel documento={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo de 45 dias." }] }] }} />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    expect(screen.getByText("desatualizada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aplicar sugestão" })).toBeNull();
  });

  it("lote: pendente não conta como aberto; 'Adicionar à revisão' e 'Enviar revisão (N)' chamam as actions", async () => {
    montar([thread({ pendente: true, respostas: [{ id: "r1", autor: { id: "u1", nome: "Eu" }, texto: "resp", criadoEm: "2026-11-03T12:00:00.000Z", viaMcp: false, pendente: true }] })]);
    expect(screen.getByText(/0 abertos · 0 resolvidos/)).toBeTruthy();
    expect(screen.getAllByText("pendente")).toHaveLength(2);
    acoes.enviarRevisaoAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar revisão \(2\)/ })));
    expect(acoes.enviarRevisaoAction).toHaveBeenCalledWith("p1");

    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "guardar" } });
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Adicionar à revisão" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "guardar", null, { pendente: true });

    acoes.descartarPendenteAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^Descartar$/ })[0]));
    expect(acoes.descartarPendenteAction).toHaveBeenCalled();
  });

  it("citar para sugerir: o texto novo começa do trecho e a action leva a sugestão; trecho de outro bloco não sugere", async () => {
    let citar: ((a: { trecho: string; antes: string; depois: string } | null, o?: { sugerir?: boolean }) => void) | undefined;
    const Citador = () => {
      citar = useComentarios()?.citar;
      return null;
    };
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
        <Citador />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    const a = { trecho: "30 dias", antes: "", depois: "" };
    act(() => citar!(a, { sugerir: true }));
    const novo = screen.getByLabelText("Texto novo do trecho") as HTMLTextAreaElement;
    expect(novo.value).toBe("30 dias");
    expect(document.activeElement).toBe(novo);
    expect(screen.getByRole("button", { name: "Sugerir agora" })).toBeDisabled();
    fireEvent.change(novo, { target: { value: "45 dias" } });
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sugerir agora" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "", a, { pendente: false, sugestao: "45 dias" });

    act(() => citar!({ trecho: "a\nb", antes: "", depois: "" }));
    expect(screen.queryByRole("button", { name: "Sugerir texto" })).toBeNull();
    act(() => citar!({ trecho: "só um", antes: "", depois: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Sugerir texto" }));
    expect((screen.getByLabelText("Texto novo do trecho") as HTMLTextAreaElement).value).toBe("só um");
  });

  it("comentário em campo: cartão e formulário mostram o dado; sem sugestão", async () => {
    let citarCampo: ((c: "valor") => void) | undefined;
    const Citador = () => {
      citarCampo = useComentarios()?.citarCampo;
      return null;
    };
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread({ id: "c9", ancora: null, campo: "prazo" })] }}>
        <Citador />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    expect(screen.getByText("Dados · Prazo")).toBeTruthy();
    act(() => citarCampo!("valor"));
    expect(screen.getByText("Dados · Valor total")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sugerir texto" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Comentário sobre o dado"), { target: { value: "caro" } });
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar agora" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "caro", null, { pendente: false, campo: "valor" });
  });

  it("setas passam pelos gerais e alterados, além dos trechos", async () => {
    const espiar = vi.fn();
    Element.prototype.scrollIntoView = espiar;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
      f(0);
      return 0;
    });
    montar([thread(), thread({ id: "c2", ancora: null, texto: "geral aqui" }), thread({ id: "c3", ancora: { trecho: "sumiu", antes: "", depois: "" }, texto: "antigo" })]);
    const ativos: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Próximo comentário" }));
      ativos.push(document.querySelector("li.border-warn")?.getAttribute("data-thread") ?? null);
    }
    expect(ativos).toEqual(["c2", "c3", "c1"]);
    expect(espiar).toHaveBeenCalled();
    raf.mockRestore();
  });
});
