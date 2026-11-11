import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave, FALHA_REDE, type EstadoAutosave, type RespostaGravacao } from "./autosave";

type Chamada = { revisao: number; doc: string };

function montar(responder: (c: Chamada) => RespostaGravacao | Promise<RespostaGravacao>) {
  const chamadas: Chamada[] = [];
  const estados: EstadoAutosave[] = [];
  const a = new Autosave<string>({
    revisao: 0,
    atrasoMs: 1000,
    salvarTexto: async (revisao, doc) => {
      chamadas.push({ revisao, doc });
      return responder({ revisao, doc });
    },
    aoMudar: (e) => estados.push(e),
  });
  return { a, chamadas, estados, ultimo: () => estados[estados.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosave", () => {
  it("espera parar de digitar e grava só o último texto, com a revisão devolvida", async () => {
    const { a, chamadas, ultimo } = montar((c) => ({ ok: true, revisao: c.revisao + 1 }));
    a.alterou("o");
    await vi.advanceTimersByTimeAsync(500);
    a.alterou("ol");
    a.alterou("olá");
    expect(ultimo()).toEqual({ tipo: "pendente" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(chamadas).toEqual([{ revisao: 0, doc: "olá" }]);
    expect(ultimo()).toMatchObject({ tipo: "salvo" });
    a.alterou("olá!");
    await vi.advanceTimersByTimeAsync(1000);
    expect(chamadas[1]).toEqual({ revisao: 1, doc: "olá!" });
    expect(a.revisaoAtual).toBe(2);
    expect(a.temPendencia).toBe(false);
  });

  it("digitou durante a gravação: grava de novo em seguida, em fila (nunca duas ao mesmo tempo)", async () => {
    let soltar!: () => void;
    let emVoo = 0;
    let maxEmVoo = 0;
    const { a, chamadas } = montar(async (c) => {
      emVoo++;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      if (c.doc === "a") await new Promise<void>((r) => (soltar = r));
      emVoo--;
      return { ok: true, revisao: c.revisao + 1 };
    });
    a.alterou("a");
    await vi.advanceTimersByTimeAsync(1000);
    a.alterou("ab");
    expect(a.temPendencia).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(chamadas.map((c) => [c.revisao, c.doc])).toEqual([
      [0, "a"],
      [1, "ab"],
    ]);
    expect(maxEmVoo).toBe(1);
  });

  it("conflito: para de gravar, guarda o texto local; 'manter o meu' grava sobre a revisão nova", async () => {
    let servidor = 5;
    const { a, chamadas, ultimo } = montar((c) =>
      c.revisao === servidor ? { ok: true, revisao: ++servidor } : { ok: false, erro: "conflito", conflito: { revisao: servidor, por: "Gil", viaMcp: true, em: null } },
    );
    a.alterou("meu texto");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ultimo()).toMatchObject({ tipo: "conflito", conflito: { revisao: 5, por: "Gil" } });
    a.alterou("meu texto 2");
    await vi.advanceTimersByTimeAsync(5000);
    expect(chamadas).toHaveLength(1); // nada gravado durante o conflito
    expect(a.temPendencia).toBe(true);
    await a.manterMeu(5, "meu texto 2");
    expect(chamadas[1]).toEqual({ revisao: 5, doc: "meu texto 2" });
    expect(ultimo()).toMatchObject({ tipo: "salvo" });
  });

  it("conflito: 'carregar o do servidor' descarta o local e segue da revisão nova", async () => {
    const { a, chamadas, ultimo } = montar((c) => (c.revisao === 3 ? { ok: true, revisao: 4 } : { ok: false, erro: "conflito", conflito: { revisao: 3, por: null, viaMcp: false, em: null } }));
    a.alterou("x");
    await vi.advanceTimersByTimeAsync(1000);
    a.usarDoServidor(3);
    expect(a.temPendencia).toBe(false);
    expect(ultimo()).toMatchObject({ tipo: "salvo" });
    a.alterou("y");
    await vi.advanceTimersByTimeAsync(1000);
    expect(chamadas[1]).toEqual({ revisao: 3, doc: "y" });
  });

  it("erro de rede ou do servidor (com ref): o texto continua pendente e 'agora' tenta de novo", async () => {
    let falhar: "rede" | "servidor" | null = "rede";
    const { a, chamadas, ultimo } = montar((c) => {
      if (falhar === "rede") throw new TypeError("fetch failed");
      if (falhar === "servidor") return { ok: false, erro: "INESPERADO", ref: "abc12345" };
      return { ok: true, revisao: c.revisao + 1 };
    });
    a.alterou("importante");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ultimo()).toEqual({ tipo: "erro", texto: FALHA_REDE, ref: undefined });
    expect(a.temPendencia).toBe(true);
    falhar = "servidor";
    await a.agora();
    expect(ultimo()).toEqual({ tipo: "erro", texto: "INESPERADO", ref: "abc12345" });
    falhar = null;
    await a.agora();
    expect(chamadas.map((c) => c.doc)).toEqual(["importante", "importante", "importante"]);
    expect(ultimo()).toMatchObject({ tipo: "salvo" });
  });

  it("executar (estruturado / versão) entra na mesma fila e usa a revisão da gravação anterior", async () => {
    const { a } = montar((c) => ({ ok: true, revisao: c.revisao + 1 }));
    a.alterou("texto");
    const pendente = a.agora();
    const vistas: number[] = [];
    const versao = a.executar(async (rev) => {
      vistas.push(rev);
      return { ok: true, revisao: rev + 1 };
    }, true);
    await pendente;
    await versao;
    expect(vistas).toEqual([1]);
    expect(a.revisaoAtual).toBe(2);
  });

  it("versão leva o texto do editor: o autosave agendado é cancelado", async () => {
    const { a, chamadas } = montar((c) => ({ ok: true, revisao: c.revisao + 1 }));
    a.alterou("rascunho");
    await a.executar(async (rev) => ({ ok: true, revisao: rev + 1 }), true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chamadas).toEqual([]);
    expect(a.temPendencia).toBe(false);
  });

  it("resposta informativa (nada mudou) não vira erro nem bloqueia; o texto que ia junto volta para a fila", async () => {
    const salvarTexto = vi.fn().mockResolvedValue({ ok: true, revisao: 2 });
    const estados: string[] = [];
    const a = new Autosave<string>({ revisao: 1, atrasoMs: 10, salvarTexto, aoMudar: (e) => estados.push(e.tipo) });
    a.alterou("texto");
    const r = await a.executar(async () => ({ ok: false, erro: "Nada mudou", informativo: true }), true);
    expect(r).toMatchObject({ informativo: true });
    expect(estados).not.toContain("erro");
    await a.agora();
    expect(salvarTexto).toHaveBeenCalledWith(1, "texto");
    expect(a.situacao.tipo).toBe("salvo");
  });

  it("versão que falha devolve o texto à fila, com o erro e a ref", async () => {
    const a = new Autosave<string>({ revisao: 1, atrasoMs: 10, salvarTexto: vi.fn(), aoMudar: () => undefined });
    a.alterou("rascunho");
    await a.executar(async () => ({ ok: false, erro: "falhou", ref: "abc" }), true);
    expect(a.situacao).toEqual({ tipo: "erro", texto: "falhou", ref: "abc" });
    // O texto que iria na versão volta a ser pendente: repetir (versão ou texto) ainda o leva.
    expect(a.temPendencia).toBe(true);
  });

  it("'tentar de novo' sem nada pendente limpa o erro de outra gravação", async () => {
    const a = new Autosave<string>({ revisao: 1, atrasoMs: 10, salvarTexto: vi.fn(), aoMudar: () => undefined });
    await a.executar(async () => ({ ok: false, erro: "falhou" }));
    expect(a.situacao.tipo).toBe("erro");
    await a.agora();
    expect(a.situacao.tipo).toBe("salvo");
  });
});
