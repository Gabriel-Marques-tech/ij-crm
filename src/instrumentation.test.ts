// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const ordem: string[] = [];
vi.mock("@/lib/config/tecnica", () => ({ carregarConfigTecnica: vi.fn(async () => (ordem.push("carregar"), { ok: true })) }));
vi.mock("@/lib/config/env", () => ({ validarConfigLlm: vi.fn(() => ordem.push("validar")) }));

const { register } = await import("./instrumentation");
const envOriginal = { ...process.env };

afterEach(() => {
  process.env = { ...envOriginal };
  ordem.length = 0;
});

describe("register (boot)", () => {
  it("carrega a config do Admin ANTES de validar a config de LLM (limiares salvos passam pela regra de ordem)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    expect(ordem).toEqual(["carregar", "validar"]);
  });

  it("no build não toca o banco, só valida o env", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await register();
    expect(ordem).toEqual(["validar"]);
  });
});
