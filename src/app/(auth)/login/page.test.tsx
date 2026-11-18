import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/atual", () => ({ usuarioAtual: async () => null }));
vi.mock("@/lib/auth/actions", () => ({ loginAction: vi.fn() }));

const { default: LoginPage } = await import("./page");

async function renderizar(params: Record<string, string> = {}) {
  render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tela de login", () => {
  it("sem GOOGLE_CLIENT_ID/SECRET o botão do Google some; senha continua", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    await renderizar();
    expect(screen.queryByText("Entrar com Google")).toBeNull();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByText("Sem acesso? Peça a um gestor para cadastrar seu email.")).toBeInTheDocument();
  });

  it("configurado: botão acima do formulário, levando o destino seguro", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "segredo");
    await renderizar({ voltar: "/oauth/autorizar?x=1" });
    const botao = screen.getByRole("link", { name: "Entrar com Google" });
    expect(botao).toHaveAttribute("href", `/api/auth/google?voltar=${encodeURIComponent("/oauth/autorizar?x=1")}`);
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    // botão vem antes do campo de email
    expect(botao.compareDocumentPosition(screen.getByLabelText("Email")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("voltar externo não vai para o link do Google", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "segredo");
    await renderizar({ voltar: "//evil.example" });
    expect(screen.getByRole("link", { name: "Entrar com Google" })).toHaveAttribute("href", "/api/auth/google");
  });

  it("erro do callback aparece com a ref", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "segredo");
    await renderizar({ erro: "nao_cadastrado", ref: "ab12cd34" });
    expect(screen.getByRole("alert")).toHaveTextContent("Seu email não está cadastrado no CRM. Peça a um gestor.");
    expect(screen.getByRole("alert")).toHaveTextContent("ref: ab12cd34");
  });

  it("erro de domínio cita o domínio permitido; ref forjada não aparece", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "segredo");
    vi.stubEnv("GOOGLE_DOMINIOS_PERMITIDOS", "sou.inteli.edu.br");
    await renderizar({ erro: "dominio", ref: "<script>" });
    expect(screen.getByRole("alert")).toHaveTextContent("Use sua conta Google @sou.inteli.edu.br.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("<script>");
  });
});
