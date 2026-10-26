/**
 * Limitador de tentativas em memória (processo único — design §4.1).
 * Chave = email + IP. Depois de `maxFalhas` dentro da janela, bloqueia até a
 * janela expirar. Reinício do processo zera — aceitável para 15 usuários.
 */
export class Limitador {
  private readonly falhas = new Map<string, number[]>();

  constructor(private readonly cfg: { maxFalhas: number; janelaMs: number }) {}

  private recentes(chave: string, agora: number): number[] {
    const lista = (this.falhas.get(chave) ?? []).filter((t) => agora - t < this.cfg.janelaMs);
    if (lista.length) this.falhas.set(chave, lista);
    else this.falhas.delete(chave);
    return lista;
  }

  bloqueado(chave: string, agora: number = Date.now()): boolean {
    return this.recentes(chave, agora).length >= this.cfg.maxFalhas;
  }

  registrarFalha(chave: string, agora: number = Date.now()): void {
    this.falhas.set(chave, [...this.recentes(chave, agora), agora]);
  }

  registrarSucesso(chave: string): void {
    this.falhas.delete(chave);
  }
}

// Singleton do processo (sobrevive ao hot reload do Next em dev).
const g = globalThis as unknown as { limitadorLogin?: Limitador; limitadorEsqueciIp?: Limitador; limitadorEsqueciEmail?: Limitador };
export const limitadorLogin = (g.limitadorLogin ??= new Limitador({ maxFalhas: 5, janelaMs: 15 * 60 * 1000 }));
// "Esqueci a senha" (GAB-43): todo pedido conta como tentativa. 10 por IP em 15 min,
// 3 por email por hora. Acima disso a resposta é a mesma, mas nada é gravado.
export const limitadorEsqueciIp = (g.limitadorEsqueciIp ??= new Limitador({ maxFalhas: 10, janelaMs: 15 * 60 * 1000 }));
export const limitadorEsqueciEmail = (g.limitadorEsqueciEmail ??= new Limitador({ maxFalhas: 3, janelaMs: 60 * 60 * 1000 }));
