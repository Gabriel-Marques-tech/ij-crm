/**
 * Valor em dinheiro como o vendedor escreve ("15k", "uns 15 mil", "R$ 15.000",
 * "1,5 milhão") → decimal com 2 casas ("15000.00"). Puro (GAB-34).
 *
 * A LLM devolve o trecho como escrito; a conversão é deste código, para ser
 * testável e não depender de aritmética do modelo. Sem sufixo, vale o formato
 * BR estrito de `lerDinheiro` (ponto só como milhar). Com sufixo (k/mil/mi/
 * milhão), "2,5" e "2.5" são decimais.
 *
 * O multiplicador só vale COLADO ao número ("15k", "20 mil") ou fechando um
 * intervalo ("entre 10 e 15 mil", "10 a 15k"), que fica com o piso. Um "mil"
 * solto em outro lugar, ou vários números sem multiplicador ("15 pessoas,
 * orçamento 20000"), é ambíguo → null (o card vai para revisar).
 * Negativo, ilegível ou acima de Decimal(14,2) → null.
 */
import { lerDinheiro } from "@/lib/projetos/terminal-regras";

const LIMITE = 1e12; // 12 dígitos inteiros (Decimal(14,2))

const MULTIPLICADOR: Record<string, number> = { k: 1e3, mil: 1e3, mi: 1e6, m: 1e6, milhao: 1e6, milhoes: 1e6 };

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const SUF = "k|mil|milhao|milhoes|mi|m";
const INTERVALO = new RegExp(`(${NUM})\\s*(?:(${SUF})(?![a-z]))?\\s+(?:e|a|ate)\\s+(${NUM})\\s*(${SUF})(?![a-z])`);
const COLADO = new RegExp(`(${NUM})\\s*(${SUF})(?![a-z])`);
const SOLTO = /\b(?:k|mil|milhao|milhoes|mi)\b/;

/** Com multiplicador: "2,5" / "2.5" decimais; inteiros simples. */
function comMultiplicador(numero: string, sufixo: string): string | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(numero)) return null;
  return formatar(Number(numero.replace(",", ".")) * MULTIPLICADOR[sufixo]);
}

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

  const intervalo = INTERVALO.exec(t);
  if (intervalo) return comMultiplicador(intervalo[1], intervalo[2] ?? intervalo[4]);
  const colado = COLADO.exec(t);
  if (colado) return comMultiplicador(colado[1], colado[2]);
  if (SOLTO.test(t)) return null;

  const numeros = t.match(new RegExp(NUM, "g")) ?? [];
  if (numeros.length !== 1) return null;
  const r = lerDinheiro(numeros[0]);
  if (!r.ok || r.valor === null) return null;
  return formatar(Number(r.valor));
}
