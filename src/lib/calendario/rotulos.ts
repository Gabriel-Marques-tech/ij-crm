/**
 * Rótulos de dia para componentes de cliente (GAB-51). Sem imports de
 * propósito: `oportunidades/formatar` puxa `@prisma/client` (via `campos`),
 * que não roda no navegador.
 */
const DIA_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

/** `YYYY-MM-DD` → "SEG", 26, "26/10". */
export function rotuloDia(dia: string): { semana: string; numero: number; ddmm: string } {
  const d = new Date(`${dia}T12:00:00Z`);
  return { semana: DIA_SEMANA[d.getUTCDay()], numero: d.getUTCDate(), ddmm: `${dia.slice(8, 10)}/${dia.slice(5, 7)}` };
}

/** `YYYY-MM-DD` → `DD/MM/AAAA`. */
export function diaBR(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}
