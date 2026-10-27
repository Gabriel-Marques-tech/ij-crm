/**
 * Sufixo "excluída"/"mesclado" de um vínculo. Separado de `./vinculo` de
 * propósito: aquele importa `@/lib/contatos/match` → `@/lib/db`, e
 * `VinculoLink` roda no cliente (o Prisma quebra no navegador).
 */
export const SUFIXO = {
  empresa: { EXCLUIDO: "excluída", MESCLADO: "mesclada" },
  contato: { EXCLUIDO: "excluído", MESCLADO: "mesclado" },
} as const;

export function sufixoVinculo(tipo: "empresa" | "contato", estado: "EXCLUIDO" | "MESCLADO"): string {
  return SUFIXO[tipo][estado];
}
