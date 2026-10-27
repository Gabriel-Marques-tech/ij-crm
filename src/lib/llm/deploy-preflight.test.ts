// @vitest-environment node
/** `scripts/_llm.sh` (preflight do deploy.sh): recusa provedor de LLM sem chave. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../../../scripts/_llm.sh");

function checar(provedor: string, openai: string, anthropic: string, gemini = "") {
  const r = spawnSync("bash", ["-c", `source "$0"; checar_chave_llm "$1" "$2" "$3" "$4"`, SCRIPT, provedor, openai, anthropic, gemini], { encoding: "utf8" });
  return { ok: r.status === 0, erro: r.stderr };
}

describe("checar_chave_llm (deploy.sh)", () => {
  it("openai (ou vazio = padrão openai) sem OPENAI_API_KEY → recusa com motivo", () => {
    for (const p of ["openai", ""]) {
      const r = checar(p, "", "sk-ant-x");
      expect(r.ok, p).toBe(false);
      expect(r.erro).toContain("OPENAI_API_KEY");
    }
  });

  it("anthropic sem ANTHROPIC_API_KEY → recusa", () => {
    const r = checar("anthropic", "sk-x", "");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("ANTHROPIC_API_KEY");
  });

  it("mock ou provedor desconhecido → recusa (o app falharia toda mensagem)", () => {
    expect(checar("mock", "sk-x", "sk-ant-x").ok).toBe(false);
    expect(checar("cohere", "sk-x", "sk-ant-x", "AIza-x").ok).toBe(false);
  });

  it("gemini sem GEMINI_API_KEY → recusa com motivo (mesmo com as outras chaves)", () => {
    const r = checar("gemini", "sk-x", "sk-ant-x", "");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("GEMINI_API_KEY");
  });

  it("provedor com a própria chave → ok (a do outro pode faltar); maiúsculas valem", () => {
    expect(checar("openai", "sk-x", "").ok).toBe(true);
    expect(checar("OpenAI", "sk-x", "").ok).toBe(true);
    expect(checar("anthropic", "", "sk-ant-x").ok).toBe(true);
    expect(checar("gemini", "", "", "AIza-x").ok).toBe(true);
    expect(checar("GEMINI", "", "", "AIza-x").ok).toBe(true);
  });
});
