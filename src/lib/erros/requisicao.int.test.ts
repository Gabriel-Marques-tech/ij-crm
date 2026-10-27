import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { notFound, redirect } from "next/navigation";
import { dbTeste } from "@/test/db";
import { onRequestError } from "@/instrumentation";
import { TelaDeErro } from "@/components/erros/tela-de-erro";

afterEach(() => vi.restoreAllMocks());

const req = { path: "/semana?email=ana@segredo.test", method: "GET", headers: {} };
const ctx = { routerKind: "App Router", routePath: "/(app)/semana", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined, renderType: "dynamic" } as const;

async function falhaDeBanco(): Promise<Error> {
  try {
    await dbTeste().$queryRawUnsafe("SELECT * FROM tabela_que_nao_existe_gab47 WHERE email = 'ana@segredo.test'");
  } catch (e) {
    return e as Error;
  }
  throw new Error("a query devia ter falhado");
}

describe("falha de banco numa página → ref do log = ref da tela", () => {
  it("onRequestError loga a causa com ref = digest e o boundary mostra o mesmo digest", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await falhaDeBanco();
    // O Next carimba o digest no erro antes de chamar onRequestError e manda só o digest ao cliente.
    const digest = "2338718455";
    Object.assign(e, { digest });

    await onRequestError(e, req, ctx);

    expect(log).toHaveBeenCalledTimes(1);
    const linha = String(log.mock.calls[0][0]);
    expect(linha.startsWith(`[render /(app)/semana] ref=${digest} Prisma`)).toBe(true);
    expect(linha).not.toContain("segredo");

    const noCliente = Object.assign(new Error("An error occurred in the Server Components render."), { digest });
    render(createElement(TelaDeErro, { error: noCliente, retry: () => {} }));
    expect(screen.getByText(digest)).toBeInTheDocument();
  });

  it("sem digest → loga com ref gerada (não perde a causa)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError(await falhaDeBanco(), req, { ...ctx, routeType: "route", routePath: "/api/x" });
    expect(String(log.mock.calls[0][0])).toMatch(/^\[route \/api\/x\] ref=[0-9a-f]{8} Prisma/);
  });

  it("redirect / notFound do Next não são logados como erro", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const lancar of [() => redirect("/login"), () => notFound()]) {
      try {
        lancar();
      } catch (e) {
        await onRequestError(e, req, ctx);
      }
    }
    expect(log).not.toHaveBeenCalled();
  });
});
