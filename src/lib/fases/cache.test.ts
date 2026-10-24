import { describe, expect, it, vi } from "vitest";
import { criarCacheMemoria } from "./cache";

describe("criarCacheMemoria", () => {
  it("carrega uma vez e serve do cache até invalidar", async () => {
    const carregar = vi.fn(async () => ({ v: Math.random() }));
    const cache = criarCacheMemoria<{ v: number }>();
    const a = await cache.obter(carregar);
    const b = await cache.obter(carregar);
    expect(b).toBe(a);
    expect(carregar).toHaveBeenCalledTimes(1);
    cache.invalidar();
    const c = await cache.obter(carregar);
    expect(c).not.toBe(a);
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("chamadas concorrentes compartilham a mesma carga", async () => {
    const carregar = vi.fn(() => new Promise<number>((r) => setTimeout(() => r(1), 5)));
    const cache = criarCacheMemoria<number>();
    await Promise.all([cache.obter(carregar), cache.obter(carregar), cache.obter(carregar)]);
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("falha na carga não fica em cache", async () => {
    let n = 0;
    const carregar = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("banco fora");
      return n;
    });
    const cache = criarCacheMemoria<number>();
    await expect(cache.obter(carregar)).rejects.toThrow("banco fora");
    expect(await cache.obter(carregar)).toBe(2);
  });

  it("invalidar durante uma carga em voo descarta o resultado dela", async () => {
    let soltar!: (v: number) => void;
    const lenta = new Promise<number>((r) => (soltar = r));
    const cache = criarCacheMemoria<number>();
    const p1 = cache.obter(() => lenta);
    cache.invalidar();
    const p2 = cache.obter(async () => 2);
    soltar(1);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(await cache.obter(async () => 3)).toBe(2);
  });
});
