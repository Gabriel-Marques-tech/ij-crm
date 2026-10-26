/** Erros/avisos do import → CSV para baixar (`;` + BOM: abre direto no Excel pt-BR). Puro, roda no cliente. */
import type { Ocorrencia } from "./interpretar";

function celula(v: string): string {
  // Fórmula no Excel ("=", "+", "-", "@") vira texto: o conteúdo veio do arquivo do usuário.
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function ocorrenciasParaCsv(linhas: (Ocorrencia & { tipo: "erro" | "aviso" })[]): string {
  const corpo = linhas.map((o) => [String(o.linha), o.pipefyId ?? "", o.tipo, o.mensagem].map(celula).join(";"));
  return `﻿${["linha;id_pipefy;tipo;mensagem", ...corpo].join("\r\n")}\r\n`;
}
