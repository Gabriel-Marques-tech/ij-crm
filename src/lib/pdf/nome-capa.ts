/**
 * Nome da empresa na capa (GAB-100): quebra em até 3 linhas, depois encolhe, e só por
 * último corta com reticências. Decide por uma estimativa de largura (sem as métricas da
 * fonte) para dar EXATAMENTE as mesmas linhas no PDF e na folha, que não mede igual.
 * Para nomes em português a estimativa nunca fica abaixo da Poppins Bold (`nome-capa.test.ts` confere
 * esses caracteres na fonte), então a linha cabe na moldura. Outros alfabetos não têm essa garantia.
 * Pode quebrar antes do necessário em nome com muita letra larga. Puro.
 */
export const TAMANHOS_NOME_CAPA = [19, 16, 14, 12] as const;
const LINHAS_MAX = 3;
/** Largura útil do texto da capa, em pontos: de 11% a 88,2% da A4. */
export const LARGURA_NOME_CAPA = 595.28 * (1 - 0.118 - 0.11);

/** Largura estimada, em "em". Acima da real na Poppins Bold para os caracteres de nomes em português. */
export function larguraDoCaractere(c: string): number {
  if (c === " ") return 0.3;
  if (/[MWmw@%&—]/.test(c)) return 1.1;
  if (/[il.,:;'|!]/.test(c)) return 0.4;
  if (/\p{Lu}/u.test(c)) return 0.84;
  return 0.7;
}

const estimar = (t: string, tamanho: number) => [...t].reduce((s, c) => s + larguraDoCaractere(c), 0) * tamanho;

function quebrar(nome: string, tamanho: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  const fechar = () => {
    if (atual) linhas.push(atual);
    atual = "";
  };
  for (const palavra of nome.split(" ")) {
    const junto = atual ? `${atual} ${palavra}` : palavra;
    if (estimar(junto, tamanho) <= LARGURA_NOME_CAPA) {
      atual = junto;
      continue;
    }
    fechar();
    // Palavra maior que a linha: parte no caractere.
    let resto = "";
    for (const c of palavra) {
      if (estimar(resto + c, tamanho) > LARGURA_NOME_CAPA) {
        linhas.push(resto);
        resto = "";
      }
      resto += c;
    }
    atual = resto;
  }
  fechar();
  return linhas;
}

export function nomeDaCapa(bruto: string): { linhas: string[]; tamanho: number } {
  const nome = bruto.replace(/\s+/g, " ").trim();
  for (const tamanho of TAMANHOS_NOME_CAPA) {
    const linhas = quebrar(nome, tamanho);
    if (linhas.length <= LINHAS_MAX) return { linhas, tamanho };
  }
  const tamanho = TAMANHOS_NOME_CAPA[TAMANHOS_NOME_CAPA.length - 1];
  const linhas = quebrar(nome, tamanho).slice(0, LINHAS_MAX);
  let ultima = [...linhas[LINHAS_MAX - 1]];
  while (ultima.length > 1 && estimar(`${ultima.join("").trimEnd()}…`, tamanho) > LARGURA_NOME_CAPA) ultima = ultima.slice(0, -1);
  linhas[LINHAS_MAX - 1] = `${ultima.join("").trimEnd()}…`;
  return { linhas, tamanho };
}
