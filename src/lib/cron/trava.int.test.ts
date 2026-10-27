// @vitest-environment node
// GAB-41 (review): trava do cron por aluguel de linha (sem segurar conexão do pool).
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { pegarTrava, soltarTrava } from "./trava";

const dbT = dbTeste();

beforeEach(async () => {
  await limparBanco(["trava_cron"]);
});

describe("trava do cron", () => {
  it("só um pega; os outros recebem null até soltar", async () => {
    const [a, b] = await Promise.all([pegarTrava("teste", 60_000), pegarTrava("teste", 60_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await pegarTrava("teste", 60_000)).toBeNull();
    await soltarTrava("teste", (a ?? b)!);
    expect(await pegarTrava("teste", 60_000)).toEqual(expect.any(String));
  });

  it("aluguel vencido (processo morreu sem soltar) → o próximo pega", async () => {
    const dono = await pegarTrava("teste", 60_000);
    expect(dono).not.toBeNull();
    await dbT.$executeRaw`UPDATE trava_cron SET expira_em = now() - interval '1 second' WHERE nome = 'teste'`;
    const novo = await pegarTrava("teste", 60_000);
    expect(novo).not.toBeNull();
    expect(novo).not.toBe(dono);
  });

  it("soltar só se ainda for o dono: o antigo não solta a trava do novo", async () => {
    const velho = (await pegarTrava("teste", 60_000))!;
    await dbT.$executeRaw`UPDATE trava_cron SET expira_em = now() - interval '1 second' WHERE nome = 'teste'`;
    const novo = (await pegarTrava("teste", 60_000))!;
    await soltarTrava("teste", velho);
    expect(await pegarTrava("teste", 60_000)).toBeNull();
    await soltarTrava("teste", novo);
    expect(await pegarTrava("teste", 60_000)).not.toBeNull();
  });

  it("travas de nomes diferentes são independentes", async () => {
    expect(await pegarTrava("a", 60_000)).not.toBeNull();
    expect(await pegarTrava("b", 60_000)).not.toBeNull();
  });
});
