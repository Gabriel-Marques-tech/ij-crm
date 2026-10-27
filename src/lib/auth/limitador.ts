/**
 * Limitador de tentativas em memória (processo único — design §4.1).
 * Depois de `maxFalhas` dentro da janela, bloqueia até a janela expirar.
 * Reinício do processo zera — aceitável para 15 usuários.
 *
 * Memória limitada (as chaves podem vir de texto escolhido por um atacante,
 * ex.: email do "esqueci a senha"): chaves expiradas são varridas a cada
 * janela e, acima de `maxChaves` (padrão 10 mil), as mais antigas saem
 * primeiro (o Map guarda ordem de inserção; cada falha reinsere a chave no fim).
 */
export class Limitador {
  private readonly falhas = new Map<string, number[]>();
  private ultimaVarredura = 0;
  private readonly maxChaves: number;

  constructor(private readonly cfg: { maxFalhas: number; janelaMs: number; maxChaves?: number }) {
    this.maxChaves = cfg.maxChaves ?? 10_000;
  }

  /** Quantas chaves estão guardadas (para testes/diagnóstico). */
  get tamanho(): number {
    return this.falhas.size;
  }

  private recentes(chave: string, agora: number): number[] {
    const lista = (this.falhas.get(chave) ?? []).filter((t) => agora - t < this.cfg.janelaMs);
    if (lista.length) this.falhas.set(chave, lista);
    else this.falhas.delete(chave);
    return lista;
  }

  private varrer(agora: number): void {
    if (agora - this.ultimaVarredura < this.cfg.janelaMs) return;
    this.ultimaVarredura = agora;
    for (const [chave, lista] of this.falhas) {
      if (lista.every((t) => agora - t >= this.cfg.janelaMs)) this.falhas.delete(chave);
    }
  }

  bloqueado(chave: string, agora: number = Date.now()): boolean {
    return this.recentes(chave, agora).length >= this.cfg.maxFalhas;
  }

  registrarFalha(chave: string, agora: number = Date.now()): void {
    this.varrer(agora);
    const lista = [...this.recentes(chave, agora), agora];
    this.falhas.delete(chave); // reinsere no fim: a ordem do Map = mais antiga primeiro
    this.falhas.set(chave, lista);
    while (this.falhas.size > this.maxChaves) {
      const maisAntiga = this.falhas.keys().next().value as string;
      this.falhas.delete(maisAntiga);
    }
  }

  registrarSucesso(chave: string): void {
    this.falhas.delete(chave);
  }
}

/**
 * "Esqueci a senha": todo pedido conta como tentativa. Freio global por IP e
 * limite por IP+email. A chave inclui o IP de propósito: um limite só por
 * email deixaria qualquer um esgotar as 3 tentativas/hora da vítima.
 */
export class FreioEsqueci {
  constructor(
    private readonly porIp: Limitador,
    private readonly porIpEmail: Limitador,
  ) {}

  /** Registra o pedido; `false` = acima do limite (a action responde igual, mas não grava nada). */
  tentar(ip: string, email: string, agora: number = Date.now()): boolean {
    const chave = `${ip}|${email}`;
    const bloqueado = this.porIp.bloqueado(ip, agora) || this.porIpEmail.bloqueado(chave, agora);
    this.porIp.registrarFalha(ip, agora);
    this.porIpEmail.registrarFalha(chave, agora);
    return !bloqueado;
  }
}

// Singletons do processo (sobrevivem ao hot reload do Next em dev).
const g = globalThis as unknown as { limitadorLogin?: Limitador; freioEsqueci?: FreioEsqueci };
export const limitadorLogin = (g.limitadorLogin ??= new Limitador({ maxFalhas: 5, janelaMs: 15 * 60 * 1000 }));
// 10 pedidos por IP em 15 min; 3 por IP+email por hora.
export const freioEsqueci = (g.freioEsqueci ??= new FreioEsqueci(
  new Limitador({ maxFalhas: 10, janelaMs: 15 * 60 * 1000 }),
  new Limitador({ maxFalhas: 3, janelaMs: 60 * 60 * 1000 }),
));
