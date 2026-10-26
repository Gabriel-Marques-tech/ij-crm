/**
 * Leitor de CSV tolerante (GAB-37). Puro, sem dependência: o export do Pipefy
 * (ou o mesmo arquivo reaberto e salvo no Excel) chega com variações que um
 * `split(",")` não aguenta:
 * - BOM UTF-8 no início; arquivo em Windows-1252 (Excel BR) — `decodificarArquivo`;
 * - separador `,`, `;` (Excel pt-BR) ou tab — detectado no cabeçalho, fora de aspas;
 * - campos entre aspas com `""` escapado, separador e QUEBRA DE LINHA dentro;
 * - CRLF/LF misturados, linhas vazias, último registro sem `\n`.
 *
 * `linha` de cada registro = linha física onde ele começa (1 = cabeçalho):
 * é o número que o gestor acha abrindo o arquivo num editor.
 */

export type RegistroCsv = { linha: number; campos: string[] };

export type ResultadoCsv = { ok: true; separador: string; registros: RegistroCsv[] } | { ok: false; erro: string };

const CANDIDATOS = [";", ",", "\t"] as const;

/** Bytes do upload → texto. UTF-8 estrito; se não for UTF-8 válido, Windows-1252 (Excel). */
export function decodificarArquivo(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Separador mais frequente na 1ª linha lógica (fora de aspas). Empate/nenhum → vírgula. */
function detectarSeparador(texto: string): string {
  const contagem = new Map<string, number>(CANDIDATOS.map((c) => [c, 0]));
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') aspas = !aspas;
    else if (!aspas && (c === "\n" || c === "\r")) break;
    else if (!aspas && contagem.has(c)) contagem.set(c, contagem.get(c)! + 1);
  }
  let melhor = ",";
  let max = 0;
  for (const [c, n] of contagem) {
    if (n > max) {
      melhor = c;
      max = n;
    }
  }
  return melhor;
}

export function lerCsv(entrada: string, opts: { maxRegistros?: number } = {}): ResultadoCsv {
  const texto = entrada.replace(/^﻿/, "");
  if (texto.trim() === "") return { ok: false, erro: "O arquivo está vazio." };
  const sep = detectarSeparador(texto);
  const max = opts.maxRegistros ?? Infinity;

  const registros: RegistroCsv[] = [];
  let campos: string[] = [];
  let campo = "";
  let aspas = false;
  let linhaFisica = 1;
  let inicioRegistro = 1;
  let inicioAspas = 1;
  let registroTemConteudo = false;

  const fecharCampo = () => {
    campos.push(campo);
    campo = "";
  };
  const fecharRegistro = (): ResultadoCsv | null => {
    fecharCampo();
    // Linha em branco (um único campo vazio) não é registro.
    if (registroTemConteudo || campos.length > 1 || campos[0] !== "") {
      registros.push({ linha: inicioRegistro, campos });
      // +1: o cabeçalho não conta como linha de dados.
      if (registros.length > max + 1) {
        return { ok: false, erro: `O arquivo tem mais de ${max} linhas de dados. Divida o export em partes menores.` };
      }
    }
    campos = [];
    registroTemConteudo = false;
    return null;
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          aspas = false;
        }
      } else if (c === "\r") {
        // CRLF dentro do campo vira \n; CR solto também.
        campo += "\n";
        if (texto[i + 1] === "\n") i++;
        linhaFisica++;
      } else {
        if (c === "\n") linhaFisica++;
        campo += c;
      }
      continue;
    }
    if (c === '"' && campo.trim() === "") {
      // Aspas só abrem no início do campo (espaços antes são descartados).
      campo = "";
      aspas = true;
      inicioAspas = linhaFisica;
      registroTemConteudo = true;
    } else if (c === sep) {
      fecharCampo();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      const falha = fecharRegistro();
      if (falha) return falha;
      linhaFisica++;
      inicioRegistro = linhaFisica;
    } else {
      campo += c;
    }
  }
  if (aspas) {
    return { ok: false, erro: `Aspas sem fechamento a partir da linha ${inicioAspas}. Confira se o arquivo é um CSV exportado do Pipefy.` };
  }
  if (campo !== "" || campos.length > 0 || registroTemConteudo) {
    const falha = fecharRegistro();
    if (falha) return falha;
  }
  if (registros.length === 0) return { ok: false, erro: "O arquivo está vazio." };
  return { ok: true, separador: sep, registros };
}
