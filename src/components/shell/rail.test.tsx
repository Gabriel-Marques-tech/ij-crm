import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, AreaEntrada, Papel } from "@prisma/client";
import type { PaginaInicial } from "@/lib/preferencias/preferencias";
import { NavegacaoAreaProvider } from "./area-atual";
import { BotaoGaveta } from "./gaveta-ij";
import { MarcarQuadroAtivo, QuadroAtivoProvider } from "./quadro-ativo";
import { Rail } from "./rail";

const nav = vi.hoisted(() => ({ pathname: "/semana", busca: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.busca),
}));

type Opcoes = { papel?: Papel; area?: Area | null; areaEntrada?: AreaEntrada | null; inicio?: PaginaInicial; ultimaArea?: Area | null; extra?: ReactNode };

function Arvore({ papel = "VENDEDOR", area = "VENDAS", areaEntrada = null, inicio = "semana", ultimaArea = null, extra }: Opcoes) {
  return (
    <QuadroAtivoProvider>
      <NavegacaoAreaProvider pessoa={{ papel, area, cargos: [], areaEntrada }} inicio={inicio} ultimaArea={ultimaArea}>
        <Rail />
        {extra}
      </NavegacaoAreaProvider>
    </QuadroAtivoProvider>
  );
}

const desktop = () => screen.getAllByRole("navigation", { name: "Principal", hidden: true })[0];
const mobile = () => screen.getAllByRole("navigation", { name: "Principal", hidden: true })[1];
const botao = () => within(desktop()).getByRole("button", { name: "Abrir menu de áreas", hidden: true });
const gaveta = () => screen.queryByRole("dialog");

beforeEach(() => {
  nav.pathname = "/semana";
  nav.busca = "";
  document.cookie = "ij_area=; path=/; max-age=0";
});

describe("Rail: ícone da IJ", () => {
  it("mostra o símbolo da IJ com alt em português e abre a gaveta, sem navegar", () => {
    render(<Arvore />);
    const logo = within(desktop()).getByRole("img", { name: "Inteli Júnior" });
    expect(logo.getAttribute("src")).toContain("simbolo-ij");
    expect(logo.closest("a")).toBeNull();
    expect(desktop().textContent).not.toMatch(/^IJ/);
    expect(logo.closest("button")).toHaveAttribute("aria-haspopup", "dialog");
    expect(logo.closest("button")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Menu por área", () => {
  it("vendedor em Vendas vê o menu de Vendas, igual no desktop e na barra inferior", () => {
    render(<Arvore />);
    const links = within(desktop()).getAllByRole("link").map((l) => l.textContent);
    expect(links).toEqual(["Minha Semana", "Kanban de vendas", "Propostas", "Tabela", "Ranking", "Contatos", "Empresas", "Calendário"]);
    expect(within(mobile()).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual(links);
  });

  it("vendedor no quadro de Projetos vê o menu de visitante, e o indicador mostra a área", () => {
    nav.pathname = "/kanban";
    nav.busca = "quadro=projetos";
    render(<Arvore />);
    expect(within(desktop()).getAllByRole("link").map((l) => l.textContent)).toEqual(["Kanban de projetos", "Propostas", "Contatos", "Empresas", "Calendário"]);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
    expect(within(desktop()).getByRole("link", { name: "Kanban de projetos" })).toHaveAttribute("aria-current", "page");
  });

  it("visualizador não recebe Tabela, Ranking, Propostas, Calendário nem Semana", () => {
    nav.pathname = "/painel";
    render(<Arvore papel="VISUALIZADOR" area={null} />);
    expect(within(desktop()).getAllByRole("link").map((l) => l.textContent)).toEqual(["Kanban de vendas", "Contatos", "Empresas"]);
  });
});

describe("Área atual", () => {
  it("rota sem área mantém a última aberta (cookie)", () => {
    nav.pathname = "/contatos";
    render(<Arvore ultimaArea="PROJETOS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
  });

  it("sem cookie vale a área da pessoa", () => {
    nav.pathname = "/contatos";
    render(<Arvore papel="PROJETOS" area="PROJETOS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
  });

  it("sem cookie, admin usa a área de entrada", () => {
    nav.pathname = "/contatos";
    render(<Arvore papel="ADMIN" area={null} areaEntrada="PROJETOS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
  });

  it("Minha Semana da pessoa vence o cookie: o item existe no menu dela", () => {
    render(<Arvore ultimaArea="PROJETOS" />);
    expect(within(desktop()).getByRole("link", { name: "Minha Semana" })).toHaveAttribute("aria-current", "page");
    expect(document.cookie).toContain("ij_area=VENDAS");
  });

  it("quadro desconhecido não derruba a página: cai na última área", () => {
    nav.pathname = "/kanban";
    nav.busca = "quadro=constructor";
    render(<Arvore ultimaArea="PROJETOS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
  });

  it("entrada vence cookie antigo: admin em /semana?area=PROJETOS vê Projetos e o cookie é atualizado", () => {
    document.cookie = "ij_area=VENDAS; path=/";
    nav.busca = "area=PROJETOS";
    render(<Arvore papel="ADMIN" area={null} areaEntrada="PROJETOS" ultimaArea="VENDAS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
    expect(within(desktop()).queryByRole("link", { name: "Tabela" })).toBeNull();
    expect(document.cookie).toContain("ij_area=PROJETOS");
  });

  it("?area= inválido é ignorado: vale o cookie", () => {
    nav.busca = "area=constructor";
    render(<Arvore papel="ADMIN" area={null} ultimaArea="VENDAS" />);
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Vendas");
  });

  it("depois da entrada, escolher outra área na gaveta e ir à Semana sem o parâmetro mantém a escolha", async () => {
    nav.busca = "area=PROJETOS";
    const { rerender } = render(<Arvore papel="ADMIN" area={null} areaEntrada="PROJETOS" ultimaArea="VENDAS" />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("link", { name: "Vendas" }));
    await waitFor(() => expect(gaveta()).toBeNull());
    nav.busca = "";
    rerender(<Arvore papel="ADMIN" area={null} areaEntrada="PROJETOS" ultimaArea="VENDAS" />);
    await waitFor(() => expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Vendas"));
    expect(document.cookie).toContain("ij_area=VENDAS");
  });

  it("detalhe do card usa o quadro do card, grava em cookie e a área fica ao sair para rota sem área", async () => {
    nav.pathname = "/projetos/abc";
    const { rerender } = render(<Arvore extra={<MarcarQuadroAtivo quadro="projetos" />} />);
    await waitFor(() => expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos"));
    expect(document.cookie).toContain("ij_area=PROJETOS");
    nav.pathname = "/contatos";
    rerender(<Arvore />);
    await waitFor(() => expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos"));
  });
});

describe("Gaveta", () => {
  it("nunca abre sozinha", () => {
    render(<Arvore />);
    expect(gaveta()).toBeNull();
  });

  it("abre pelo ícone com áreas e Geral; vendedor sem Gestão; destaca a área da pessoa", async () => {
    render(<Arvore />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog", { name: "Inteli Júnior" });
    const areas = within(d).getByRole("navigation", { name: "Áreas" });
    expect(within(areas).getByRole("link", { name: /Vendas/ })).toHaveTextContent("sua área");
    expect(within(areas).getByRole("link", { name: /Vendas/ })).toHaveAttribute("aria-current", "true");
    expect(within(areas).getByRole("link", { name: "Projetos" })).toHaveAttribute("href", "/kanban?quadro=projetos");
    const geral = within(d).getByRole("navigation", { name: "Geral" });
    expect(within(geral).getAllByRole("link").map((l) => l.textContent)).toEqual(["Painel", "Membros", "Meu perfil"]);
  });

  it("gestor e admin veem Gestão", async () => {
    render(<Arvore papel="ADMIN" area={null} />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    expect(within(d).getByRole("link", { name: "Gestão" })).toHaveAttribute("href", "/gestao");
  });

  it("a preferência vale dentro da área: kanban leva ao quadro; admin com semana leva à semana nas duas", async () => {
    render(<Arvore papel="ADMIN" area={null} inicio="semana" />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    expect(within(d).getByRole("link", { name: "Projetos" })).toHaveAttribute("href", "/semana");
  });

  it("Esc fecha e devolve o foco ao ícone", async () => {
    render(<Arvore />);
    botao().focus();
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    await waitFor(() => expect(within(d).getByRole("link", { name: /Vendas/ })).toHaveFocus());
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(gaveta()).toBeNull());
    await waitFor(() => expect(botao()).toHaveFocus());
  });

  it("clique fora fecha", async () => {
    render(<Arvore />);
    fireEvent.click(botao());
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);
    });
    await waitFor(() => expect(gaveta()).toBeNull());
  });

  it("escolher um item de Geral fecha", async () => {
    render(<Arvore />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("link", { name: "Painel" }));
    await waitFor(() => expect(gaveta()).toBeNull());
  });

  it("escolher área fecha e já troca o menu, mesmo que o destino seja rota sem área", async () => {
    nav.pathname = "/contatos";
    render(<Arvore papel="ADMIN" area={null} ultimaArea="VENDAS" />);
    fireEvent.click(botao());
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("link", { name: "Projetos" }));
    await waitFor(() => expect(gaveta()).toBeNull());
    expect(document.cookie).toContain("ij_area=PROJETOS");
    expect(within(desktop()).queryByRole("link", { name: "Tabela" })).toBeNull();
    expect(within(desktop()).getByText("Área atual:").parentElement).toHaveTextContent("Projetos");
  });

  it("o botão do mobile abre a mesma gaveta", async () => {
    render(<Arvore extra={<BotaoGaveta tamanho={32} className="topbar" />} />);
    const noTopo = screen.getAllByRole("button", { name: "Abrir menu de áreas" }).find((b) => b.classList.contains("topbar"))!;
    fireEvent.click(noTopo);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
