import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schemaPadraoDeTeste, urlDeTeste } from "./db";

let antes: string | undefined;
beforeEach(() => {
  antes = process.env.DATABASE_URL_TEST;
});
afterEach(() => {
  if (antes === undefined) delete process.env.DATABASE_URL_TEST;
  else process.env.DATABASE_URL_TEST = antes;
});

describe("urlDeTeste", () => {
  it("recusa URL de teste que não aponte para o schema ijcrm_test", () => {
    process.env.DATABASE_URL_TEST = "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm?schema=public";
    expect(() => urlDeTeste()).toThrow(/ijcrm_test/);
  });

  it("DATABASE_URL_TEST explícita tem precedência", () => {
    process.env.DATABASE_URL_TEST = "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm?schema=ijcrm_test_xyz";
    expect(urlDeTeste()).toContain("schema=ijcrm_test_xyz");
  });

  it("sem DATABASE_URL_TEST: schema próprio do diretório (worktrees paralelos nunca dividem o ijcrm_test)", () => {
    delete process.env.DATABASE_URL_TEST;
    const hash = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8);
    expect(schemaPadraoDeTeste()).toBe(`ijcrm_test_${hash}`);
    expect(schemaPadraoDeTeste("/outro/worktree")).not.toBe(schemaPadraoDeTeste());
    expect(new URL(urlDeTeste()).searchParams.get("schema")).toBe(`ijcrm_test_${hash}`);
  });
});
