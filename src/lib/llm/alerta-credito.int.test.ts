// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroEnvioWhatsApp } from "@/lib/whatsapp/enviar";
import { dbTeste, limparBanco } from "@/test/db";
import { alertarSeSemCredito, estadoSemCredito, marcarCreditoOk, textoAlertaSemCredito } from "./alerta-credito";
import { ErroLlm } from "./tipos";

const dbT = dbTeste();
const OPS = "120363000000000099@g.us";
const envOriginal = { ...process.env };
const SEM_CREDITO = new ErroLlm("SEM_CREDITO", { status: 402 });

function logs(...spies: unknown[]): string {
  return spies.map((s) => (s as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n")).join("\n");
}

function enviarFalso() {
  return vi.fn(async (envio: { para: string; texto: string }) => ({ eventoId: `EVT-${envio.para}`, enviada: true }));
}

async function linha() {
  return dbT.alertaOperacional.findUnique({ where: { chave: "LLM_SEM_CREDITO" } });
}

/** Simula a passagem do tempo: o próximo aviso já venceu. */
async function vencerCooldown() {
  await dbT.alertaOperacional.update({ where: { chave: "LLM_SEM_CREDITO" }, data: { proximoAvisoEm: new Date(Date.now() - 1000) } });
}

beforeEach(async () => {
  await limparBanco(["alerta_operacional"]);
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.ALERTA_OPS_JID = OPS;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...envOriginal };
});

describe("alertarSeSemCredito", () => {
  it("texto do aviso tem a ref e nada da mensagem do grupo", () => {
    expect(textoAlertaSemCredito("abc12345")).toBe(
      "⚠️ Sem crédito na API de LLM. Mensagens do grupo estão ficando em FALHA e serão reprocessadas depois da recarga. ref: abc12345",
    );
  });

  it("1º SEM_CREDITO avisa uma vez; os seguintes dentro do cooldown de 6 h não", async () => {
    const enviar = enviarFalso();
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar })).toBe("ENVIADO");
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00002", { enviar })).toBe("EM_COOLDOWN");
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00003", { enviar })).toBe("EM_COOLDOWN");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toEqual({ para: OPS, texto: textoAlertaSemCredito("ref00001") });

    const l = await linha();
    const horas = (l!.proximoAvisoEm!.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(5.9);
    expect(horas).toBeLessThanOrEqual(6);
    expect(l!.avisadoEm).not.toBeNull();
  });

  it("depois do cooldown, avisa de novo", async () => {
    const enviar = enviarFalso();
    await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar });
    await vencerCooldown();
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00002", { enviar })).toBe("ENVIADO");
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it("envio falhou → re-tenta em 5 min, não em 6 h", async () => {
    const enviar = vi.fn(async () => {
      throw new ErroEnvioWhatsApp("Evolution sendText: timeout após 60000ms");
    });
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar })).toBe("FALHOU_ENVIO");
    const l = await linha();
    const min = (l!.proximoAvisoEm!.getTime() - Date.now()) / 60_000;
    expect(min).toBeGreaterThan(4.9);
    expect(min).toBeLessThanOrEqual(5);
    expect(l!.avisadoEm).toBeNull();
    // Dentro dos 5 min: não insiste.
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00002", { enviar })).toBe("EM_COOLDOWN");
    expect(logs(console.error)).toContain("ErroEnvioWhatsApp");

    await vencerCooldown();
    const ok = enviarFalso();
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00003", { enviar: ok })).toBe("ENVIADO");
  });

  it("safe mode (NOTIFICATIONS_ENABLED≠true) → só loga, não envia nem consome o cooldown", async () => {
    delete process.env.NOTIFICATIONS_ENABLED;
    const enviar = enviarFalso();
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar })).toBe("SO_LOG");
    expect(enviar).not.toHaveBeenCalled();
    expect(logs(console.warn)).toContain("ref=ref00001");
    expect((await linha())!.proximoAvisoEm).toBeNull();
    // Banner continua valendo.
    expect(await estadoSemCredito()).not.toBeNull();
  });

  it("ALERTA_OPS_JID vazio → só loga; banner continua valendo", async () => {
    process.env.ALERTA_OPS_JID = "  ";
    const enviar = enviarFalso();
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar })).toBe("SO_LOG");
    expect(enviar).not.toHaveBeenCalled();
    expect(await estadoSemCredito()).not.toBeNull();
  });

  it("outros erros (LLM ou não) são ignorados", async () => {
    const enviar = enviarFalso();
    expect(await alertarSeSemCredito(new ErroLlm("TIMEOUT"), "r", { enviar })).toBe("IGNORADO");
    expect(await alertarSeSemCredito(new Error("x"), "r", { enviar })).toBe("IGNORADO");
    expect(enviar).not.toHaveBeenCalled();
    expect(await linha()).toBeNull();
  });

  it("aceita SEM_CREDITO de qualquer provedor (só olha o código)", async () => {
    const enviar = enviarFalso();
    const deOutroProvedor = new ErroLlm("SEM_CREDITO", { status: 429, detalhe: "sem crédito na API da OpenAI" });
    expect(await alertarSeSemCredito(deOutroProvedor, "ref00001", { enviar })).toBe("ENVIADO");
  });

  it("nunca lança: erro do sender inesperado ou do banco vira log com ref", async () => {
    const enviar = vi.fn(async () => {
      throw new TypeError("boom com texto sensível");
    });
    await expect(alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar })).resolves.toBe("FALHOU_ENVIO");
    expect(logs(console.error)).not.toContain("texto sensível");

    const quebrado = { $queryRaw: () => Promise.reject(new Error("banco fora")) } as never;
    await expect(alertarSeSemCredito(SEM_CREDITO, "ref00002", { enviar, db: quebrado })).resolves.toBe("ERRO");
    await expect(marcarCreditoOk({ db: quebrado })).resolves.toBeUndefined();
    await expect(estadoSemCredito({ db: quebrado })).resolves.toBeNull();
  });
});

describe("banner (estadoSemCredito) e marcarCreditoOk", () => {
  it("sem ocorrência → sem banner", async () => {
    expect(await estadoSemCredito()).toBeNull();
    await marcarCreditoOk(); // sem linha: no-op
    expect(await linha()).toBeNull();
  });

  it("SEM_CREDITO liga o banner; a 1ª chamada que dá certo desliga e libera o próximo aviso", async () => {
    const enviar = enviarFalso();
    await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar });
    const desde = (await estadoSemCredito())!.desde;
    await alertarSeSemCredito(SEM_CREDITO, "ref00002", { enviar });
    // `desde` é a 1ª ocorrência, não a última.
    expect((await estadoSemCredito())!.desde).toEqual(desde);

    await marcarCreditoOk();
    expect(await estadoSemCredito()).toBeNull();

    // Nova falta de crédito depois de normalizar = novo incidente: avisa já.
    expect(await alertarSeSemCredito(SEM_CREDITO, "ref00003", { enviar })).toBe("ENVIADO");
    expect(await estadoSemCredito()).not.toBeNull();
  });

  it("ocorrência com mais de 24 h sem novas → banner some sozinho", async () => {
    await alertarSeSemCredito(SEM_CREDITO, "ref00001", { enviar: enviarFalso() });
    const antes = new Date(Date.now() - 25 * 3_600_000);
    await dbT.alertaOperacional.update({ where: { chave: "LLM_SEM_CREDITO" }, data: { ativoDesde: antes, ultimaOcorrenciaEm: antes } });
    expect(await estadoSemCredito()).toBeNull();
  });
});
