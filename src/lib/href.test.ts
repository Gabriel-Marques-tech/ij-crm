import { describe, expect, it } from "vitest";
import { hrefSeguro } from "./href";

describe("hrefSeguro", () => {
  it("aceita só http(s) absoluto", () => {
    expect(hrefSeguro("https://acme.com.br/x")).toBe("https://acme.com.br/x");
    expect(hrefSeguro(" http://acme.com ")).toBe("http://acme.com/");
  });

  it("recusa javascript:, data:, relativo e vazio", () => {
    for (const v of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<script>", "acme.com", "//acme.com", "", null, undefined]) {
      expect(hrefSeguro(v)).toBeNull();
    }
  });
});
