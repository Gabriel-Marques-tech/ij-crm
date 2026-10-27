import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/erros/requisicao");
  vi.resetModules();
});

const ctx = { routerKind: "App Router", routePath: "/semana", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined, renderType: "dynamic" } as const;

describe("onRequestError nunca deixa a ref da tela sem linha no log", () => {
  it("se o registro falhar, ainda loga [contexto] ref=<digest>", async () => {
    vi.doMock("@/lib/erros/requisicao", () => ({
      registrarErroDeRequisicao: () => {
        throw new Error("registrador quebrou");
      },
    }));
    const { onRequestError } = await import("@/instrumentation");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError(Object.assign(new Error("x"), { digest: "123" }), { path: "/semana", method: "GET", headers: {} }, ctx);
    expect(log).toHaveBeenCalledWith("[render /semana] ref=123");
  });
});
