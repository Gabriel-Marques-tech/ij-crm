import { describe, expect, it } from "vitest";
import { criarLimitador } from "./limitador";

function adiado() {
  let soltar!: () => void;
  const p = new Promise<void>((r) => (soltar = r));
  return { p, soltar };
}

describe("criarLimitador", () => {
  it("roda no máximo N ao mesmo tempo, enfileira até o limite e recusa (null) além dele", async () => {
    const lim = criarLimitador(2, 1);
    const portao = adiado();
    let rodando = 0;
    let pico = 0;
    const tarefa = async () => {
      rodando++;
      pico = Math.max(pico, rodando);
      await portao.p;
      rodando--;
      return "ok";
    };
    const a = lim.executar(tarefa);
    const b = lim.executar(tarefa);
    const c = lim.executar(tarefa); // fila
    const d = lim.executar(tarefa); // fila cheia
    expect(a && b && c).toBeTruthy();
    expect(d).toBeNull();
    expect(lim.estado()).toEqual({ rodando: 2, naFila: 1 });
    portao.soltar();
    expect(await Promise.all([a, b, c])).toEqual(["ok", "ok", "ok"]);
    expect(pico).toBe(2);
    expect(lim.estado()).toEqual({ rodando: 0, naFila: 0 });
  });

  it("erro na tarefa libera a vaga e chega a quem chamou", async () => {
    const lim = criarLimitador(1, 0);
    await expect(lim.executar(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(lim.executar(async () => 1)).resolves.toBe(1);
  });
});
