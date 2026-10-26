/**
 * Valor em dinheiro como o vendedor escreve ("15k", "uns 15 mil", "R$ 15.000",
 * "1,5 milhão") → decimal com 2 casas ("15000.00"). Puro (GAB-34).
 *
 * A LLM devolve o trecho como escrito; a conversão é deste código, para ser
 * testável e não depender de aritmética do modelo. Sem sufixo, vale o formato
 * BR estrito de `lerDinheiro` (ponto só como milhar). Com sufixo (k/mil/mi/
 * milhão), "2,5" e "2.5" são decimais. Intervalo ("entre 10 e 15 mil") fica
 * com o primeiro número e o primeiro multiplicador: o piso, conservador.
 * Negativo, ilegível ou acima de Decimal(14,2) → null.
 */
import { lerDinheiro } from "@/lib/oportunidades/terminal-regras";

const LIMITE = 1e12; // 12 dígitos inteiros (Decimal(14,2))

const MULTIPLICADOR: Record<string, number> = { k: 1e3, mil: 1e3, mi: 1e6, m: 1e6, milhao: 1e6, milhoes: 1e6 };

function simplificar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function formatar(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || n >= LIMITE) return null;
  return n.toFixed(2);
}

export function lerValorInformal(entrada: string | number | null | undefined): string | null {
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada === "number") return formatar(entrada);
  const t = simplificar(entrada);
  if (!t || /-\s*\d/.test(t)) return null;

  const num = /(\d+(?:[.,]\d+)*)\s*(k|mil|milhao|milhoes|mi|m)?(?![a-z])/.exec(t);
  if (!num) return null;
  const sufixo = num[2] ?? /\b(k|mil|milhao|milhoes|mi)\b/.exec(t.slice(num.index + num[0].length))?.[1];
  if (sufixo) {
    // Com multiplicador: "2,5" / "2.5" decimais; inteiros simples.
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(num[1])) return null;
    return formatar(Number(num[1].replace(",", ".")) * MULTIPLICADOR[sufixo]);
  }
  const r = lerDinheiro(num[1]);
  if (!r.ok || r.valor === null) return null;
  return formatar(Number(r.valor));
}
