import { describe, expect, it } from "vitest";
import { urlDeTeste } from "./db";

describe("urlDeTeste", () => {
  it("recusa URL de teste que não aponte para o schema ijcrm_test", () => {
    const antes = process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL_TEST = "postgresql://ijcrm:ijcrm@localhost:5432/ijcrm?schema=public";
    try {
      expect(() => urlDeTeste()).toThrow(/ijcrm_test/);
    } finally {
      if (antes === undefined) delete process.env.DATABASE_URL_TEST;
      else process.env.DATABASE_URL_TEST = antes;
    }
  });

  it("deriva de DATABASE_URL trocando o schema", () => {
    expect(urlDeTeste()).toContain("schema=ijcrm_test");
  });
});
