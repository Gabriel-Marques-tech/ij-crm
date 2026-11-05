/**
 * Parte ESTRUTURADA da proposta (spec fase 2 §4.5): valor, prazo, escopo
 * resumido e cronograma de entregas. É ela que alimenta a regra de §4.4
 * (mudou escopo/prazo/valor → volta para projetos), o contrato e a execução.
 *
 * Entrada = strings do formulário/MCP (dinheiro no formato BR "12.500,00",
 * dia "AAAA-MM-DD", duração "2 semanas"); saída = forma canônica gravada (rascunho e snapshot da
 * versão). Validado SEMPRE no servidor (o formulário só ajuda). Puro.
 */
import { z } from "zod";
// Sem `@/lib/projetos/campos` (importa enum do Prisma como valor): este módulo roda no cliente também.
import { lerDinheiro } from "@/lib/projetos/terminal-regras";

export const ESCOPO_RESUMO_MAX = 2000;
export const TITULO_ENTREGA_MAX = 200;
export const ENTREGAS_MAX = 50;
export const PRAZO_DIAS_MAX = 3650;

export const DURACAO_MAX_CAMPO = 30;

/**
 * A entrega tem data OU duração (GAB-100, spec proposta-folha §5). `dia` é `null` de
 * propósito, e não "": quem usa a entrega (a cópia para a execução, GAB-95) não compila
 * sem decidir o que fazer com a que só tem duração, em vez de descartá-la em silêncio.
 * Entregas antigas têm só data e continuam válidas.
 */
export type Entrega = { titulo: string; dia: string | null; duracao: string | null; valor: string | null };

/** Forma gravada: valor decimal com ponto ("12500.00"), prazo em dias corridos. */
export type Estruturado = {
  valor: string | null;
  prazoDias: number | null;
  escopoResumo: string | null;
  entregas: Entrega[];
};

export const ESTRUTURADO_VAZIO: Estruturado = { valor: null, prazoDias: null, escopoResumo: null, entregas: [] };

/** O que o formulário e o MCP mandam (tudo texto; ausente = vazio). */
export const estruturadoEntradaSchema = z
  .object({
    valor: z.string().max(50).optional(),
    prazoDias: z.union([z.string().max(10), z.number()]).optional(),
    escopoResumo: z.string().max(ESCOPO_RESUMO_MAX * 2).optional(),
    entregas: z
      .array(z.object({ titulo: z.string().max(TITULO_ENTREGA_MAX * 2), dia: z.string().max(20).optional(), duracao: z.string().max(DURACAO_MAX_CAMPO).optional(), valor: z.string().max(50).optional() }).strict())
      .max(ENTREGAS_MAX * 2)
      .optional(),
  })
  .strict();

export type EstruturadoEntrada = z.infer<typeof estruturadoEntradaSchema>;

export type ResultadoEstruturado = { ok: true; valor: Estruturado } | { ok: false; erro: string };

/** "AAAA-MM-DD" de um dia que existe no calendário (30/02 não). */
export function diaValido(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === dia;
}

const UNIDADES_DURACAO: { padrao: RegExp; dias: number; um: string; varios: string }[] = [
  { padrao: /^(d|dia|dias)$/, dias: 1, um: "dia", varios: "dias" },
  { padrao: /^(sem|semana|semanas)$/, dias: 7, um: "semana", varios: "semanas" },
  { padrao: /^(m[eê]s|meses)$/, dias: 30, um: "mês", varios: "meses" },
];

function partesDaDuracao(bruta: string): { n: number; unidade: (typeof UNIDADES_DURACAO)[number] } | null {
  const m = /^(\d{1,4})\s*([\p{L}]+)\.?$/u.exec(bruta.trim().toLowerCase());
  if (!m || Number(m[1]) < 1) return null;
  const unidade = UNIDADES_DURACAO.find((u) => u.padrao.test(m[2]));
  // Mesmo teto do prazo: a data prevista (`datasPrevistas`) continua dentro do que a execução aceita.
  return unidade && Number(m[1]) * unidade.dias <= PRAZO_DIAS_MAX ? { n: Number(m[1]), unidade } : null;
}

/** "2 sem", "2 Semanas" → "2 semanas"; o que não for duração → null. */
export function normalizarDuracao(bruta: string): string | null {
  const p = partesDaDuracao(bruta);
  return p ? `${p.n} ${p.n === 1 ? p.unidade.um : p.unidade.varios}` : null;
}

/** Dias corridos de uma duração (mês = 30 dias). */
export function duracaoEmDias(duracao: string): number | null {
  const p = partesDaDuracao(duracao);
  return p ? p.n * p.unidade.dias : null;
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Data prevista de cada entrega para a execução (GAB-95). As durações são etapas em
 * sequência, como no modelo da IJ: cada uma conta a partir do fim da anterior, e a
 * primeira a partir de `inicio`; entrega com data fica na data e passa a ser o novo
 * ponto de partida. Mesma ordem e mesmo tamanho da entrada. `dia` null = linha gravada
 * estranha, sem data válida nem duração que se entenda: não muda a conta das outras,
 * e quem copia decide o que fazer com ela.
 */
export function datasPrevistas(entregas: readonly Entrega[], inicio: string): { titulo: string; dia: string | null; valor: string | null }[] {
  let base = inicio;
  return entregas.map((e) => {
    const dias = e.duracao === null ? null : duracaoEmDias(e.duracao);
    const dia = e.dia !== null ? (diaValido(e.dia) ? e.dia : null) : dias !== null ? somarDias(base, dias) : null;
    if (dia !== null) base = dia;
    return { titulo: e.titulo, dia, valor: e.valor };
  });
}

function prazo(bruto: string | number | undefined): { ok: true; v: number | null } | { ok: false } {
  if (bruto === undefined) return { ok: true, v: null };
  const t = String(bruto).trim();
  if (t === "") return { ok: true, v: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return n >= 1 && n <= PRAZO_DIAS_MAX ? { ok: true, v: n } : { ok: false };
}

export function interpretarEstruturado(bruto: unknown): ResultadoEstruturado {
  const p = estruturadoEntradaSchema.safeParse(bruto ?? {});
  if (!p.success) return { ok: false, erro: "Dados da proposta inválidos." };
  const e = p.data;

  const valor = lerDinheiro(e.valor ?? "");
  if (!valor.ok) return { ok: false, erro: "Valor inválido: use reais no formato 12.500,00 (não pode ser negativo)." };

  const pz = prazo(e.prazoDias);
  if (!pz.ok) return { ok: false, erro: `Prazo inválido: informe dias corridos, de 1 a ${PRAZO_DIAS_MAX}.` };

  const escopo = (e.escopoResumo ?? "").trim();
  if (escopo.length > ESCOPO_RESUMO_MAX) return { ok: false, erro: `Escopo resumido: no máximo ${ESCOPO_RESUMO_MAX} caracteres.` };

  const brutas = e.entregas ?? [];
  if (brutas.length > ENTREGAS_MAX) return { ok: false, erro: `O cronograma pode ter até ${ENTREGAS_MAX} entregas.` };
  const entregas: Entrega[] = [];
  for (const [i, en] of brutas.entries()) {
    const rotulo = `Entrega ${i + 1}`;
    const titulo = en.titulo.replace(/\s+/g, " ").trim();
    if (titulo === "" || titulo.length > TITULO_ENTREGA_MAX) return { ok: false, erro: `${rotulo}: dê um nome (até ${TITULO_ENTREGA_MAX} caracteres).` };
    const dia = (en.dia ?? "").trim();
    const durBruta = (en.duracao ?? "").trim();
    if (dia && durBruta) return { ok: false, erro: `${rotulo}: informe a data ou a duração, não as duas.` };
    if (!dia && !durBruta) return { ok: false, erro: `${rotulo}: informe a data ou a duração (como "2 semanas").` };
    if (dia && !diaValido(dia)) return { ok: false, erro: `${rotulo}: data inválida (use AAAA-MM-DD).` };
    const duracao = durBruta ? normalizarDuracao(durBruta) : null;
    if (durBruta && !duracao) return { ok: false, erro: `${rotulo}: duração inválida (dias, semanas ou meses, como "2 semanas", até ${PRAZO_DIAS_MAX} dias).` };
    const v = lerDinheiro(en.valor ?? "");
    if (!v.ok) return { ok: false, erro: `${rotulo}: valor inválido (formato 12.500,00, não negativo).` };
    entregas.push({ titulo, dia: dia || null, duracao, valor: v.valor });
  }

  const diasDeDuracao = entregas.reduce((soma, x) => soma + (x.duracao ? (duracaoEmDias(x.duracao) ?? 0) : 0), 0);
  if (diasDeDuracao > PRAZO_DIAS_MAX) return { ok: false, erro: `As durações somam mais de ${PRAZO_DIAS_MAX} dias.` };

  return { ok: true, valor: { valor: valor.valor, prazoDias: pz.v, escopoResumo: escopo || null, entregas } };
}

/** Lê o JSON gravado (rascunho/snapshot) de volta; defensivo contra linha antiga/estranha. */
export function lerEstruturadoGravado(json: unknown): Estruturado {
  if (!json || typeof json !== "object" || Array.isArray(json)) return ESTRUTURADO_VAZIO;
  const o = json as Record<string, unknown>;
  const entregas = Array.isArray(o.entregas)
    ? o.entregas.flatMap((x) => {
        const e = x as Record<string, unknown>;
        // Antiga só tem `dia`. Sem data nem duração é linha estranha: nunca passa pela validação de gravação.
        const dia = typeof e?.dia === "string" && e.dia !== "" ? e.dia : null;
        const duracao = typeof e?.duracao === "string" && e.duracao !== "" ? e.duracao : null;
        return typeof e?.titulo === "string" && (dia !== null || duracao !== null) ? [{ titulo: e.titulo, dia, duracao, valor: typeof e.valor === "string" ? e.valor : null }] : [];
      })
    : [];
  return {
    valor: typeof o.valor === "string" ? o.valor : null,
    prazoDias: typeof o.prazoDias === "number" ? o.prazoDias : null,
    escopoResumo: typeof o.escopoResumo === "string" ? o.escopoResumo : null,
    entregas,
  };
}

/** Mesmo conteúdo estruturado (para "nada mudou desde a última versão"). */
export function mesmoEstruturado(a: Estruturado, b: Estruturado): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const BR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "12500.00" → "12.500,00" (o formato que o formulário e o MCP mandam de volta). */
export function valorParaCampo(v: string | null): string {
  return v === null ? "" : BR.format(Number(v)).replace(/ /g, " ");
}

/**
 * O formulário da tela: tudo texto, tudo presente. `chaveNova` marca, só na edição, a linha que ainda
 * não foi gravada (nunca vai para o servidor: ver `paraEnvio`).
 */
export type FormularioEstruturado = { valor: string; prazoDias: string; escopoResumo: string; entregas: { titulo: string; dia: string; duracao: string; valor: string; chaveNova?: string }[] };

/** Forma gravada → entrada (para o formulário começar do que está salvo). */
export function estruturadoParaEntrada(e: Estruturado): FormularioEstruturado {
  return {
    valor: valorParaCampo(e.valor),
    prazoDias: e.prazoDias === null ? "" : String(e.prazoDias),
    escopoResumo: e.escopoResumo ?? "",
    entregas: e.entregas.map((x) => ({ titulo: x.titulo, dia: x.dia ?? "", duracao: x.duracao ?? "", valor: valorParaCampo(x.valor) })),
  };
}

/** O formulário sem as marcas de edição: é a única forma que vai para o servidor. */
export function paraEnvio(f: FormularioEstruturado): FormularioEstruturado {
  return { ...f, entregas: f.entregas.map(({ titulo, dia, duracao, valor }) => ({ titulo, dia, duracao, valor })) };
}

/**
 * O que dá para gravar agora de um formulário com parte inválida (ao sair da tela, ao marcar
 * inviável): cada campo válido vai, e o inválido fica como estava em `salvo`. No cronograma, só
 * linha marcada como nova (`chaveNova`) pode ser descartada. Com alguma linha já gravada incompleta,
 * vai `salvo.entregas` inteiro mais as linhas novas válidas: nada aqui apaga entrega gravada, e a
 * nova não se perde por causa da outra. `chaves` = linhas novas que foram junto.
 */
export function formularioGravavel(f: FormularioEstruturado, salvo: FormularioEstruturado): { form: FormularioEstruturado; chaves: string[] } {
  const ok = (e: EstruturadoEntrada) => interpretarEstruturado(e).ok;
  const valida = (en: FormularioEstruturado["entregas"][number]) => ok({ entregas: paraEnvio({ ...f, entregas: [en] }).entregas });
  const gravadaIncompleta = f.entregas.some((en) => !en.chaveNova && !valida(en));
  const linhas = gravadaIncompleta ? [...salvo.entregas, ...f.entregas.filter((en) => en.chaveNova && valida(en))] : f.entregas.filter(valida);
  const entregas = paraEnvio({ ...f, entregas: linhas }).entregas;
  const cabe = ok({ entregas });
  return {
    form: {
      valor: ok({ valor: f.valor }) ? f.valor : salvo.valor,
      prazoDias: ok({ prazoDias: f.prazoDias }) ? f.prazoDias : salvo.prazoDias,
      escopoResumo: ok({ escopoResumo: f.escopoResumo }) ? f.escopoResumo : salvo.escopoResumo,
      entregas: cabe ? entregas : salvo.entregas,
    },
    chaves: cabe ? linhas.flatMap((en) => (en.chaveNova ? [en.chaveNova] : [])) : [],
  };
}

/** Soma das parcelas do cronograma (string decimal) — a tela compara com o valor total. */
export function somaDasParcelas(entregas: readonly Entrega[]): string | null {
  const com = entregas.filter((e) => e.valor !== null);
  if (com.length === 0) return null;
  const centavos = com.reduce((s, e) => s + Math.round(Number(e.valor) * 100), 0);
  return (centavos / 100).toFixed(2);
}
