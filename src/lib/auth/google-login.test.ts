// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emailParaBusca } from "./google-login";

describe("emailParaBusca (casamento exato, sem curinga nem Unicode)", () => {
  it("só muda maiúsculas e espaços nas pontas", () => {
    expect(emailParaBusca(" Ana.Silva@Sou.Inteli.Edu.Br ")).toBe("ana.silva@sou.inteli.edu.br");
  });

  it("`_` e `%` continuam literais (a busca é por igualdade, não ILIKE)", () => {
    expect(emailParaBusca("jo_o.silva@sou.inteli.edu.br")).toBe("jo_o.silva@sou.inteli.edu.br");
    expect(emailParaBusca("jo%o@sou.inteli.edu.br")).toBe("jo%o@sou.inteli.edu.br");
  });

  it("sinal Kelvin (U+212A) e outros não-ASCII → null (toLowerCase viraria 'k')", () => {
    expect(emailParaBusca("Karla@sou.inteli.edu.br")).toBeNull();
    expect(emailParaBusca("joão@sou.inteli.edu.br")).toBeNull();
  });

  it("nada que a normalização aparasse: <>, aspas, ponto final", () => {
    expect(emailParaBusca("<ana@sou.inteli.edu.br>")).toBeNull();
    expect(emailParaBusca("ana@sou.inteli.edu.br.")).toBeNull();
    expect(emailParaBusca("sem-arroba")).toBeNull();
  });
});
