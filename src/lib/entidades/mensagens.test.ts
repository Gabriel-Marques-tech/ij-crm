import { describe, expect, it } from "vitest";
import { mensagemFalhaContato, mensagemFalhaEmpresa } from "./mensagens";

describe("mensagens de duplicado", () => {
  it("telefone repetido cita o dono e devolve o vínculo sugerido", () => {
    const m = mensagemFalhaContato({
      ok: false,
      erro: "PONTO_DUPLICADO",
      ponto: { tipo: "TELEFONE", valorNormalizado: "+5511999998888" },
      contato: { id: "c1", nome: "Gustavo Saab", deletado: false },
    });
    expect(m).toEqual({ erro: "Esse telefone já é de Gustavo Saab.", duplicado: { tipo: "contato", id: "c1", nome: "Gustavo Saab", deletado: false } });
  });

  it("email de contato excluído avisa que está excluído", () => {
    const m = mensagemFalhaContato({ ok: false, erro: "PONTO_DUPLICADO", ponto: { tipo: "EMAIL", valorNormalizado: "a@b.co" }, contato: { id: "c1", nome: "Ana", deletado: true } });
    expect(m.erro).toBe("Esse email já é de Ana (contato excluído).");
  });

  it("CNPJ repetido cita a empresa", () => {
    expect(mensagemFalhaEmpresa({ ok: false, erro: "CNPJ_DUPLICADO", empresa: { id: "e1", nome: "Acme", deletado: false } })).toEqual({
      erro: "Esse CNPJ já é de Acme.",
      duplicado: { tipo: "empresa", id: "e1", nome: "Acme", deletado: false },
    });
    expect(mensagemFalhaEmpresa({ ok: false, erro: "CNPJ_DUPLICADO", empresa: { id: "e1", nome: "Acme", deletado: true } }).erro).toBe("Esse CNPJ já é de Acme (empresa excluída).");
  });
});
