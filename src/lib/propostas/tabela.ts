/**
 * Regras da tabela livre da proposta (GAB-102) que valem igual na folha, no editor e no
 * PDF: os limites e a largura das colunas. Puro, sem dependências: roda no cliente e no servidor.
 *
 * A linha de total é só uma marca de quem escreve (fundo e negrito). Nada aqui soma nem
 * confere valores: o que está escrito na célula é o que sai.
 */
import type { NoTexto, Tabela } from "./documento";

/** Linhas contam o cabeçalho. Com 8 colunas, a célula ainda tem cerca de 47 pt úteis na A4. */
export const TABELA_LINHAS_MAX = 100;
export const TABELA_COLUNAS_MAX = 8;
export const CELULA_MAX = 1000;

export type MedidasTabela = { linhas: number; colunas: number; maiorCelula: number };

/** Texto para a pessoa (ou para quem usa o MCP) entender o limite; null = dentro dos limites. */
export function motivoForaDoLimite(m: MedidasTabela): string | null {
  if (m.linhas > TABELA_LINHAS_MAX) return `A tabela pode ter até ${TABELA_LINHAS_MAX} linhas (esta teria ${m.linhas}).`;
  if (m.colunas > TABELA_COLUNAS_MAX) return `A tabela pode ter até ${TABELA_COLUNAS_MAX} colunas (esta teria ${m.colunas}).`;
  if (m.maiorCelula > CELULA_MAX) return `A célula da tabela pode ter até ${CELULA_MAX} caracteres (esta teria ${m.maiorCelula}).`;
  return null;
}

const textoDe = (nos: NoTexto[] | undefined) => (nos ?? []).map((n) => n.text).join("");

export function medirTabela(t: Tabela): MedidasTabela {
  let maiorCelula = 0;
  for (const l of t.content) for (const c of l.content) maiorCelula = Math.max(maiorCelula, textoDe(c.content[0]?.content).length);
  return { linhas: t.content.length, colunas: t.content[0]?.content.length ?? 0, maiorCelula };
}

/** Acima disto, mais texto na célula não pede coluna mais larga: ele quebra em linhas. */
const PESO_MAX = 30;
const PESO_MIN = 4;

/**
 * Largura das colunas em frações (somam 1), pelo texto mais longo de cada uma. A mesma conta na
 * folha e no PDF, para a quebra de linha sair parecida. Nenhuma coluna fica com menos que metade
 * da parte igual, então coluna curta ao lado de texto longo continua legível.
 */
export function largurasDaTabela(t: Tabela): number[] {
  const n = t.content[0]?.content.length ?? 0;
  if (n === 0) return [];
  const pesos = Array.from({ length: n }, (_, j) => {
    let maior = 0;
    for (const l of t.content) maior = Math.max(maior, textoDe(l.content[j]?.content[0]?.content).length);
    return Math.min(PESO_MAX, Math.max(PESO_MIN, maior));
  });
  const soma = pesos.reduce((a, b) => a + b, 0);
  const piso = 0.5 / n;
  return pesos.map((p) => piso + 0.5 * (p / soma));
}
