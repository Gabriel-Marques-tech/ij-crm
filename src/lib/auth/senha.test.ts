import { describe, expect, it } from "vitest";
import { gerarHashSenha, senhaAtendeRegras, verificarSenha } from "./senha";

describe("senha", () => {
  it("hash verifica a senha certa e rejeita a errada", async () => {
    const hash = await gerarHashSenha("correta-123");
    expect(hash).not.toContain("correta-123");
    expect(await verificarSenha(hash, "correta-123")).toBe(true);
    expect(await verificarSenha(hash, "errada-123")).toBe(false);
  });

  it("hash nulo nunca verifica (usuário sem senha)", async () => {
    expect(await verificarSenha(null, "qualquer")).toBe(false);
    expect(await verificarSenha(null, "")).toBe(false);
  });

  it("regras: mínimo 8 caracteres", () => {
    expect(senhaAtendeRegras("1234567")).toBe(false);
    expect(senhaAtendeRegras("12345678")).toBe(true);
  });
});
