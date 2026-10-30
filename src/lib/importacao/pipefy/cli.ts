/**
 * `pnpm import:pipefy <arquivo.csv> [--confirmar] [--mapa mapa.json] [--colunas colunas.json] [--motivo-perda chave] [--usuario email]`
 * (GAB-37, go-live). Dry-run por padrão: mostra a mesma prévia da tela e não grava.
 * `--confirmar` grava com o mapeamento padrão (ou o de `--mapa`: JSON
 * `{ "<fase do Pipefy>": "<id da fase no CRM>" | null }`, chaves como na prévia).
 * O import fica no nome de `--usuario` (ou `IMPORT_USUARIO_EMAIL`, ou o
 * primeiro ADMIN ativo); precisa ser ADMIN/GESTOR ativo. Erros e avisos vão
 * para `<arquivo>.erros.csv`. `--colunas`: JSON `{ "<campo>": ["Cabeçalho no CSV", ...] }`
 * (campos de `CAMPOS` em colunas.ts) — aliases extras, com prioridade sobre os padrões.
 * `--motivo-perda`: motivo (preco, timing, concorrente, sem_resposta, outro) para
 * cards em PERDIDO sem "Motivo da perda" no CSV; sem ele, esses cards são pulados.
 */
import { temPapelMinimo } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { mensagemSegura } from "@/lib/erros/registrar";
import { normalizarEmail } from "@/lib/normalizacao";
import { decodificarArquivo } from "./csv";
import { CAMPOS, combinarAliases, type Aliases, type Campo } from "./colunas";
import { ocorrenciasParaCsv } from "./erros-csv";
import type { Ocorrencia } from "./interpretar";
import { calcularPrevia, importarConteudo } from "./servico";
import { validarOpcoes, type OpcoesImport } from "./opcoes";

export type IoCli = {
  log: (msg: string) => void;
  erro: (msg: string) => void;
  ler: (caminho: string) => Uint8Array;
  escrever: (caminho: string, conteudo: string) => void;
  env?: Record<string, string | undefined>;
};

export const USO = "uso: pnpm import:pipefy <arquivo.csv> [--confirmar] [--mapa mapa.json] [--colunas colunas.json] [--motivo-perda chave] [--usuario email]";

type Args = { arquivo: string; confirmar: boolean; mapa?: string; colunas?: string; usuario?: string; motivoPerda?: string };

export function lerArgs(argv: string[]): { ok: true; args: Args } | { ok: false; erro: string } {
  let arquivo: string | undefined;
  let confirmar = false;
  let mapa: string | undefined;
  let usuario: string | undefined;
  let colunas: string | undefined;
  let motivoPerda: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirmar") confirmar = true;
    else if (a === "--mapa" || a === "--usuario" || a === "--colunas" || a === "--motivo-perda") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) return { ok: false, erro: `${a} precisa de um valor.` };
      if (a === "--mapa") mapa = v;
      else if (a === "--colunas") colunas = v;
      else if (a === "--motivo-perda") motivoPerda = v;
      else usuario = v;
    } else if (a.startsWith("--")) return { ok: false, erro: `Opção desconhecida: ${a}` };
    else if (arquivo) return { ok: false, erro: "Informe um arquivo só." };
    else arquivo = a;
  }
  if (!arquivo) return { ok: false, erro: "Informe o arquivo CSV." };
  return { ok: true, args: { arquivo, confirmar, mapa, colunas, usuario, ...(motivoPerda ? { motivoPerda } : {}) } };
}

export function validarColunas(bruto: unknown): { ok: true; extras: Partial<Record<Campo, string[]>> } | { ok: false; erro: string } {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, erro: "--colunas: o JSON precisa ser um objeto { campo: [cabeçalhos] }." };
  const extras: Partial<Record<Campo, string[]>> = {};
  for (const [k, v] of Object.entries(bruto)) {
    if (!(CAMPOS as readonly string[]).includes(k)) return { ok: false, erro: `--colunas: campo desconhecido "${k}". Campos: ${CAMPOS.join(", ")}.` };
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return { ok: false, erro: `--colunas: "${k}" precisa ser uma lista de textos.` };
    extras[k as Campo] = v;
  }
  return { ok: true, extras };
}

async function quemImporta(email: string | undefined) {
  const normalizado = email ? normalizarEmail(email) : null;
  if (email && !normalizado) return { ok: false as const, erro: `Email inválido: ${email}` };
  const where = normalizado ? { email: normalizado } : { papel: "ADMIN" as const, ativo: true };
  const u = await db.usuario.findFirst({ where, orderBy: { criadoEm: "asc" }, select: { id: true, email: true, papel: true, ativo: true } });
  if (!u) return { ok: false as const, erro: email ? `Usuário ${email} não encontrado.` : "Nenhum ADMIN ativo. Use --usuario <email>." };
  if (!u.ativo || !temPapelMinimo(u.papel, "GESTOR")) return { ok: false as const, erro: `${u.email} precisa ser ADMIN ou GESTOR ativo.` };
  return { ok: true as const, usuario: u };
}

function salvarOcorrencias(io: IoCli, arquivo: string, erros: Ocorrencia[], avisos: Ocorrencia[]) {
  if (erros.length + avisos.length === 0) return;
  const destino = `${arquivo}.erros.csv`;
  const linhas = [...erros.map((o) => ({ ...o, tipo: "erro" as const })), ...avisos.map((o) => ({ ...o, tipo: "aviso" as const }))].sort((a, b) => a.linha - b.linha);
  io.escrever(destino, ocorrenciasParaCsv(linhas));
  io.log(`erros/avisos por linha: ${destino}`);
}

/** Devolve o código de saída: 0 ok, 1 erro de uso/arquivo/import. */
export async function rodarCli(argv: string[], io: IoCli, agora = new Date()): Promise<number> {
  const a = lerArgs(argv);
  if (!a.ok) {
    io.erro(`${a.erro}\n${USO}`);
    return 1;
  }
  const { arquivo, confirmar } = a.args;
  let conteudo: string;
  let mapeamento: unknown;
  let aliases: Aliases | undefined;
  const lerJson = (c: string): unknown => JSON.parse(new TextDecoder().decode(io.ler(c)));
  try {
    conteudo = decodificarArquivo(io.ler(arquivo));
    if (a.args.mapa) mapeamento = lerJson(a.args.mapa);
    if (a.args.colunas) {
      const extras = validarColunas(lerJson(a.args.colunas));
      if (!extras.ok) {
        io.erro(extras.erro);
        return 1;
      }
      aliases = combinarAliases(extras.extras);
    }
  } catch (e) {
    io.erro(`Não consegui ler ${(e as { path?: string }).path ?? arquivo}: ${mensagemSegura(e)}`);
    return 1;
  }
  const op = validarOpcoes(a.args.motivoPerda ? { motivoPerdaPadrao: a.args.motivoPerda } : {});
  if (!op.ok) {
    io.erro(`${op.erro} Use: preco, timing, concorrente, sem_resposta ou outro.`);
    return 1;
  }
  const opcoes: OpcoesImport = op.opcoes;
  const quem = await quemImporta(a.args.usuario ?? io.env?.IMPORT_USUARIO_EMAIL);
  if (!quem.ok) {
    io.erro(quem.erro);
    return 1;
  }

  const r = await calcularPrevia(conteudo, { nomeArquivo: arquivo, mapeamento, aliases, opcoes });
  if (!r.ok) {
    io.erro(r.erro);
    return 1;
  }
  const p = r.previa;
  const porId = new Map(p.fasesCrm.map((f) => [f.id, f]));
  io.log(`arquivo: ${arquivo} (separador "${p.separador}", ${p.totalLinhas} linhas)`);
  io.log(`cards: ${p.cards} — novos ${p.novos}, já existem ${p.existentes}, repetidos ${p.duplicadas}, vão para Projetos ${p.comProjeto}, com erro ${p.erros.length}`);
  io.log("mapeamento de fases (chave do Pipefy → fase do CRM):");
  for (const f of p.fases) {
    const d = f.faseId ? porId.get(f.faseId) : undefined;
    io.log(`  ${JSON.stringify(f.chave)} (${f.cardsAtuais}) → ${d ? `${d.pipelineNome} / ${d.nome} [${d.id}]` : "SEM CORRESPONDÊNCIA"}`);
  }
  if (p.perdidosSemMotivo > 0) {
    io.log(
      opcoes.motivoPerdaPadrao
        ? `perdidos sem motivo no CSV: ${p.perdidosSemMotivo} (gravados com o motivo "${opcoes.motivoPerdaPadrao}", definido por quem importa)`
        : `perdidos sem motivo no CSV: ${p.perdidosSemMotivo} (serão pulados; use --motivo-perda para definir um)`,
    );
  }
  if (p.responsaveisSemMatch.length) {
    io.log(`responsáveis sem usuário (ficam com ${quem.usuario.email} + revisar): ${p.responsaveisSemMatch.map((x) => `${x.nome} (${x.cards})`).join(", ")}`);
  }

  if (!confirmar) {
    salvarOcorrencias(io, arquivo, p.erros, p.avisos);
    io.log("dry-run: nada foi gravado. Rode de novo com --confirmar para importar.");
    return 0;
  }

  const imp = await importarConteudo(conteudo, r.mapeamento, quem.usuario, agora, { aliases, opcoes });
  if (!imp.ok) {
    io.erro(imp.erro);
    return 1;
  }
  const rel = imp.relatorio;
  io.log(`import concluído: criados ${rel.criados}, atualizados ${rel.atualizados} (sem mudança ${rel.semMudanca}), pulados ${rel.pulados}, foram para Projetos ${rel.projetosCriados}`);
  salvarOcorrencias(io, arquivo, rel.erros, rel.avisos);
  if (rel.interrompido) {
    io.erro(`import INTERROMPIDO (ref: ${rel.interrompido.ref}): ${rel.interrompido.naoProcessados} cards não foram processados. O que está acima foi gravado; rodar de novo não duplica.`);
    return 1;
  }
  return 0;
}
