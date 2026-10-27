/**
 * Arquivos da marca IJ em `public/images/marca/` (cópias WebP dos PNGs
 * aprovados; sem edição, mesmas proporções). Servidos como estão
 * (`images.unoptimized`, sem sharp na imagem de produção), então cada arquivo
 * já vem no tamanho final: ~2× a maior altura exibida, ou o original quando
 * ele é menor que isso (nunca ampliado). `largura`/`altura` são as do arquivo
 * (um teste confere) e dão a proporção; quem exibe escolhe a altura.
 */
export const MARCA = {
  logo: { src: "/images/marca/logo-ij-fundo-escuro.webp", largura: 221, altura: 144 },
  simbolo: { src: "/images/marca/simbolo-ij.webp", largura: 96, altura: 96 },
  emPe: { src: "/images/marca/mascote-em-pe.webp", largura: 273, altura: 454 },
  cabeca: { src: "/images/marca/mascote-cabeca.webp", largura: 265, altura: 210 },
  piscando: { src: "/images/marca/mascote-cabeca-piscando.webp", largura: 250, altura: 198 },
  relax: { src: "/images/marca/mascote-relax.webp", largura: 217, altura: 230 },
  placa: { src: "/images/marca/mascote-placa.webp", largura: 314, altura: 400 },
  notebook: { src: "/images/marca/mascote-notebook.webp", largura: 281, altura: 320 },
} as const;

export type ArquivoMarca = keyof typeof MARCA;
export type NomeMascote = Exclude<ArquivoMarca, "logo" | "simbolo">;

/** Largura proporcional à altura de exibição (evita layout shift: width/height batem com o arquivo). */
export function larguraPara(arquivo: ArquivoMarca, altura: number): number {
  const a = MARCA[arquivo];
  return Math.round((altura * a.largura) / a.altura);
}
