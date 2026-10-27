/**
 * CSV do Pipefy → cards prontos para importar (GAB-37). Puro: sem banco, sem
 * relógio. Erro de linha não derruba o arquivo: a linha vai para `erros` (e é
 * pulada); problema num campo opcional vira `aviso` e o campo é ignorado.
 *
 * Telefones/emails/CNPJ passam pelos normalizadores do CRM. Telefone vem com
 * `{ exigirDdi: false }` (padrão): no Pipefy o número é digitado à mão, quase
 * sempre sem +55 — é o mesmo contrato da UI. Match com o banco é por valor
 * normalizado exato (`encontrarContatoPorIdentificador`), feito no `aplicar`.
 *
 * Linhas repetidas (mesmo ID de card): idênticas contam como duplicadas e
 * somem; diferentes → fica a de "Atualizado em" mais recente (empate: a
 * última do arquivo) e as outras viram aviso.
 */
import type { Origem, TipoContatoPonto } from "@prisma/client";
import { normalizarCnpj, normalizarEmail, normalizarTelefoneBr } from "@/lib/normalizacao";
import { DESCRICAO_MAX, UFS, validarTitulo } from "@/lib/oportunidades/campos";
import { cortarTexto } from "@/lib/texto";
import { lerCsv } from "./csv";
import { ALIASES_PADRAO, mapearCabecalho, type Aliases, type Campo, type ColunaHistorico } from "./colunas";
import { lerData, lerLista, lerOrigem, lerValor, normalizarTexto } from "./valores";

export const LIMITE_LINHAS = 5000;

export type PontoCsv = { tipo: TipoContatoPonto; valorNormalizado: string; valorOriginal: string };

/** Passagem do card por uma fase (Pipefy guarda 1ª entrada e última saída por fase). */
export type HistoricoFase = { chave: string; entrada: Date | null; ultimaEntrada: Date | null; saida: Date | null };

export type CardPipefy = {
  linha: number;
  pipefyId: string;
  titulo: string;
  /** Chave normalizada da fase atual (ver `chaveFasePipefy`). */
  faseAtual: string;
  criadoEm: Date | null;
  atualizadoEm: Date | null;
  finalizadoEm: Date | null;
  /** 1º responsável do Pipefy (o CRM tem um só); os demais só no aviso. */
  responsavel: string | null;
  etiquetas: string[];
  empresa: string | null;
  cnpj: string | null;
  contatoNome: string | null;
  pontos: PontoCsv[];
  cargo: string | null;
  origem: Origem | null;
  dor: string | null;
  descricao: string | null;
  orcamento: string | null;
  valorFechado: string | null;
  motivoPerda: string | null;
  propostaUrl: string | null;
  cidade: string | null;
  estado: string | null;
  historico: HistoricoFase[];
};

export type Ocorrencia = { linha: number; pipefyId: string | null; mensagem: string };

export type FasePipefy = { chave: string; nome: string; cardsAtuais: number };

export type Interpretacao = {
  separador: string;
  totalLinhas: number;
  cards: CardPipefy[];
  erros: Ocorrencia[];
  avisos: Ocorrencia[];
  duplicadas: number;
  fases: FasePipefy[];
  colunasReconhecidas: Campo[];
  colunasHistorico: number;
  colunasIgnoradas: string[];
};

export type ResultadoInterpretacao = ({ ok: true } & Interpretacao) | { ok: false; erro: string };

/** Identidade de uma fase do Pipefy dentro do import: nome normalizado. */
export function chaveFasePipefy(nome: string): string {
  return normalizarTexto(nome);
}

const DOR_MAX = 5000;
const TITULO_MAX = 200;
/** Telefones (e emails) por card: segura o tempo de lock do lote e barra célula colada errada. */
const MAX_PONTOS = 5;
const AMBIGUO = /^(?:R\$\s*)?\d{1,3}\.\d{3}$/i;
const CAMPO_CURTO_MAX = 200;

export function interpretarCsv(texto: string, opts: { aliases?: Aliases; maxLinhas?: number } = {}): ResultadoInterpretacao {
  const csv = lerCsv(texto, { maxRegistros: opts.maxLinhas ?? LIMITE_LINHAS });
  if (!csv.ok) return csv;
  const [cab, ...dados] = csv.registros;
  const col = mapearCabecalho(cab.campos, opts.aliases ?? ALIASES_PADRAO);
  if (!col.ok) return col;
  const { colunas, historico: colsHist } = col.mapa;
  if (dados.length === 0) return { ok: false, erro: "O arquivo só tem o cabeçalho, nenhum card." };

  const erros: Ocorrencia[] = [];
  const avisos: Ocorrencia[] = [];
  // Excel costuma deixar `;;` sobrando no fim do cabeçalho: não contam como colunas.
  let colunasCab = cab.campos.length;
  while (colunasCab > 0 && cab.campos[colunasCab - 1].trim() === "") colunasCab--;
  const nomesFase = new Map<string, { nome: string; ordem: number }>();
  /** `original` = nome como o gestor escreveu (coluna de fase atual), não o normalizado do cabeçalho. */
  const registrarFase = (nome: string, original: boolean) => {
    const chave = chaveFasePipefy(nome);
    if (!chave) return;
    const f = nomesFase.get(chave);
    if (!f) nomesFase.set(chave, { nome, ordem: nomesFase.size });
    else if (original && f.nome === chave) f.nome = nome; // nome com acento/caixa ganha
  };
  for (const h of colsHist) registrarFase(h.fase, false);

  const porId = new Map<string, { card: CardPipefy; assinatura: string }>();
  let duplicadas = 0;

  for (const reg of dados) {
    const v = (c: Campo) => (colunas[c] === undefined ? "" : (reg.campos[colunas[c]!] ?? "").trim());
    const pipefyId = v("pipefyId");
    const linha = reg.linha;
    const avisar = (mensagem: string) => avisos.push({ linha, pipefyId: pipefyId || null, mensagem });
    if (reg.campos.length > cab.campos.length && reg.campos.slice(cab.campos.length).some((x) => x.trim() !== "")) {
      erros.push({ linha, pipefyId: pipefyId || null, mensagem: `Linha com ${reg.campos.length} colunas; o cabeçalho tem ${cab.campos.length}. Confira o separador/aspas.` });
      continue;
    }
    if (reg.campos.length < colunasCab) {
      erros.push({ linha, pipefyId: pipefyId || null, mensagem: `Linha com ${reg.campos.length} colunas; o cabeçalho tem ${colunasCab}. Linha cortada? Confira o separador/aspas.` });
      continue;
    }
    if (!pipefyId) {
      erros.push({ linha, pipefyId: null, mensagem: "Sem ID do card." });
      continue;
    }
    if (pipefyId.length > 64) {
      erros.push({ linha, pipefyId: null, mensagem: "ID do card inválido (mais de 64 caracteres)." });
      continue;
    }
    let tituloBruto = v("titulo").replace(/\s+/g, " ");
    if (tituloBruto.length > TITULO_MAX) {
      avisar(`"titulo" com mais de ${TITULO_MAX} caracteres: cortado.`);
      tituloBruto = tituloBruto.slice(0, TITULO_MAX);
    }
    const titulo = validarTitulo(tituloBruto);
    if (!titulo) {
      erros.push({ linha, pipefyId, mensagem: "Título vazio." });
      continue;
    }
    const faseNome = v("faseAtual").replace(/\s+/g, " ");
    if (!chaveFasePipefy(faseNome)) {
      erros.push({ linha, pipefyId, mensagem: "Sem fase atual." });
      continue;
    }

    const data = (c: Campo): Date | null => {
      const r = lerData(v(c));
      if (r.ok) return r.valor;
      avisar(`Data inválida em "${c}" (${v(c)}): ignorada.`);
      return null;
    };
    const texto = (c: Campo, max = CAMPO_CURTO_MAX): string | null => {
      const t = v(c);
      if (!t) return null;
      if (t.length > max) {
        avisar(`"${c}" com mais de ${max} caracteres: cortado.`);
        return cortarTexto(t, max).texto;
      }
      return t;
    };
    const valor = (c: Campo): string | null => {
      const r = lerValor(v(c));
      // "1.234": milhar no Brasil, mas pode ser 1,234 vindo de sistema em inglês.
      if (r.ok && r.valor && AMBIGUO.test(v(c))) avisar(`Valor ambíguo em "${c}" (${v(c)}): lido como ${r.valor.replace(".", ",")} (ponto de milhar). Confira no Pipefy.`);
      if (r.ok) return r.valor;
      avisar(`Valor inválido em "${c}" (${v(c)}): ignorado.`);
      return null;
    };

    const responsaveis = lerLista(v("responsaveis"));
    if (responsaveis.length > 1) avisar(`Card com ${responsaveis.length} responsáveis no Pipefy; o CRM usa o primeiro (${responsaveis[0]}).`);
    const etiquetas = lerLista(v("etiquetas"));

    let cnpj: string | null = null;
    if (v("cnpj")) {
      cnpj = normalizarCnpj(v("cnpj"));
      if (!cnpj) avisar(`CNPJ inválido (${v("cnpj")}): ignorado.`);
    }

    const pontos: PontoCsv[] = [];
    const vistos = new Set<string>();
    const limitar = (lista: string[], nome: string) => {
      if (lista.length <= MAX_PONTOS) return lista;
      avisar(`Card com ${lista.length} ${nome}; o import usa os ${MAX_PONTOS} primeiros (${lista.slice(MAX_PONTOS).join(", ")} ignorados).`);
      return lista.slice(0, MAX_PONTOS);
    };
    for (const original of limitar(lerLista(v("telefone")), "telefones")) {
      const n = normalizarTelefoneBr(original, { exigirDdi: false });
      if (!n) avisar(`Telefone inválido (${original}): ignorado.`);
      else if (!vistos.has(`T${n}`)) {
        vistos.add(`T${n}`);
        pontos.push({ tipo: "TELEFONE", valorNormalizado: n, valorOriginal: original });
      }
    }
    for (const original of limitar(lerLista(v("email")), "emails")) {
      const n = normalizarEmail(original);
      if (!n) avisar(`Email inválido (${original}): ignorado.`);
      else if (!vistos.has(`E${n}`)) {
        vistos.add(`E${n}`);
        pontos.push({ tipo: "EMAIL", valorNormalizado: n, valorOriginal: original });
      }
    }

    let origem: Origem | null = null;
    if (v("origem")) {
      origem = lerOrigem(v("origem"));
      if (!origem) {
        origem = "OUTRO";
        avisar(`Origem desconhecida (${v("origem")}): gravada como "Outro".`);
      }
    } else {
      // Sem coluna de origem: a IJ marcava a origem com etiqueta.
      origem = etiquetas.map(lerOrigem).find((o) => o !== null) ?? null;
    }

    let estado: string | null = v("estado").toUpperCase() || null;
    if (estado && !(UFS as readonly string[]).includes(estado)) {
      avisar(`Estado inválido (${v("estado")}): use a sigla da UF. Ignorado.`);
      estado = null;
    }

    let propostaUrl: string | null = v("propostaUrl") || null;
    if (propostaUrl) {
      let valido = false;
      try {
        const u = new URL(propostaUrl);
        valido = (u.protocol === "http:" || u.protocol === "https:") && propostaUrl.length <= 2000;
      } catch {
        /* inválido */
      }
      if (!valido) {
        avisar("Link da proposta não é http(s): ignorado.");
        propostaUrl = null;
      }
    }

    const historico = lerHistorico(reg.campos, colsHist, avisar);

    registrarFase(faseNome, true);
    const card: CardPipefy = {
      linha,
      pipefyId,
      titulo,
      faseAtual: chaveFasePipefy(faseNome),
      criadoEm: data("criadoEm"),
      atualizadoEm: data("atualizadoEm"),
      finalizadoEm: data("finalizadoEm"),
      responsavel: responsaveis[0] ?? null,
      etiquetas,
      empresa: texto("empresa"),
      cnpj,
      contatoNome: texto("contatoNome"),
      pontos,
      cargo: texto("cargo"),
      origem,
      dor: texto("dor", DOR_MAX),
      descricao: texto("descricao", DESCRICAO_MAX),
      orcamento: valor("orcamento"),
      valorFechado: valor("valorFechado"),
      motivoPerda: texto("motivoPerda", 500),
      propostaUrl,
      cidade: texto("cidade", 100),
      estado,
      historico,
    };

    const assinatura = JSON.stringify(reg.campos.map((x) => x.trim()));
    const anterior = porId.get(pipefyId);
    if (!anterior) {
      porId.set(pipefyId, { card, assinatura });
      continue;
    }
    duplicadas++;
    if (anterior.assinatura === assinatura) continue; // cópia exata: some sem aviso
    const tNovo = card.atualizadoEm?.getTime() ?? -Infinity;
    const tAnt = anterior.card.atualizadoEm?.getTime() ?? -Infinity;
    const fica = tNovo >= tAnt ? card : anterior.card;
    const sai = fica === card ? anterior.card : card;
    avisos.push({ linha: sai.linha, pipefyId, mensagem: `Card repetido no arquivo; mantida a linha ${fica.linha} (atualizada por último).` });
    porId.set(pipefyId, { card: fica, assinatura: fica === card ? assinatura : anterior.assinatura });
  }

  // Fases com 0 cards atuais e que só apareceram em cabeçalho de histórico continuam
  // listadas: o mapeamento delas define as transições retroativas.
  const cards = [...porId.values()].map((x) => x.card).sort((a, b) => a.linha - b.linha);
  const atuais = new Map<string, number>();
  for (const c of cards) atuais.set(c.faseAtual, (atuais.get(c.faseAtual) ?? 0) + 1);
  const fases = [...nomesFase.entries()]
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([chave, f]) => ({ chave, nome: f.nome, cardsAtuais: atuais.get(chave) ?? 0 }));

  return {
    ok: true,
    separador: csv.separador,
    totalLinhas: dados.length,
    cards,
    erros,
    avisos,
    duplicadas,
    fases,
    colunasReconhecidas: (Object.keys(colunas) as Campo[]).sort(),
    colunasHistorico: colsHist.length,
    colunasIgnoradas: col.mapa.ignoradas,
  };
}

function lerHistorico(campos: string[], cols: ColunaHistorico[], avisar: (m: string) => void): HistoricoFase[] {
  const porFase = new Map<string, HistoricoFase>();
  for (const c of cols) {
    if (c.tipo === "tempo") continue;
    const bruto = (campos[c.indice] ?? "").trim();
    if (!bruto) continue;
    const r = lerData(bruto);
    if (!r.ok) {
      avisar(`Data inválida no histórico da fase "${c.fase}" (${bruto}): ignorada.`);
      continue;
    }
    const chave = chaveFasePipefy(c.fase);
    const h = porFase.get(chave) ?? { chave, entrada: null, ultimaEntrada: null, saida: null };
    h[c.tipo] = r.valor;
    porFase.set(chave, h);
  }
  return [...porFase.values()].filter((h) => h.entrada || h.ultimaEntrada || h.saida);
}
