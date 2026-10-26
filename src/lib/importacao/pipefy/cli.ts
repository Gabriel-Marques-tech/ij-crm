/**
 * `pnpm import:pipefy <arquivo.csv> [--confirmar] [--mapa mapa.json] [--usuario email]`
 * (GAB-37, go-live). Dry-run por padrão: mostra a mesma prévia da tela e não grava.
 * `--confirmar` grava com o mapeamento padrão (ou o de `--mapa`: JSON
 * `{ "<fase do Pipefy>": "<id da fase no CRM>" | null }`, chaves como na prévia).
 * O import fica no nome de `--usuario` (ou `IMPORT_USUARIO_EMAIL`, ou o
 * primeiro ADMIN ativo); precisa ser ADMIN/GESTOR ativo. Erros e avisos vão
 * para `<arquivo>.erros.csv`.
 */
import { db } from "@/lib/db";
import { normalizarEmail } from "@/lib/normalizacao";
import { decodificarArquivo } from "./csv";
import { ocorrenciasParaCsv } from "./erros-csv";
import type { Ocorrencia } from "./interpretar";
import { calcularPrevia, importarConteudo } from "./servico";

export type IoCli = {
  log: (msg: string) => void;
  erro: (msg: string) => void;
  ler: (caminho: string) => Uint8Array;
  escrever: (caminho: string, conteudo: string) => void;
  env?: Record<string, string | undefined>;
};

export const USO = "uso: pnpm import:pipefy <arquivo.csv> [--confirmar] [--mapa mapa.json] [--usuario email]";

type Args = { arquivo: string; confirmar: boolean; mapa?: string; usuario?: string };

export function lerArgs(argv: string[]): { ok: true; args: Args } | { ok: false; erro: string } {
  let arquivo: string | undefined;
  let confirmar = false;
  let mapa: string | undefined;
  let usuario: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirmar") confirmar = true;
    else if (a === "--mapa" || a === "--usuario") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) return { ok: false, erro: `${a} precisa de um valor.` };
      if (a === "--mapa") mapa = v;
      else usuario = v;
    } else if (a.startsWith("--")) return { ok: false, erro: `Opção desconhecida: ${a}` };
    else if (arquivo) return { ok: false, erro: "Informe um arquivo só." };
    else arquivo = a;
  }
  if (!arquivo) return { ok: false, erro: "Informe o arquivo CSV." };
  return { ok: true, args: { arquivo, confirmar, mapa, usuario } };
}

async function quemImporta(email: string | undefined) {
  const where = email ? { email: normalizarEmail(email) } : { papel: "ADMIN" as const, ativo: true };
  const u = await db.usuario.findFirst({ where, orderBy: { criadoEm: "asc" }, select: { id: true, email: true, papel: true, ativo: true } });
  if (!u) return { ok: false as const, erro: email ? `Usuário ${email} não encontrado.` : "Nenhum ADMIN ativo. Use --usuario <email>." };
  if (!u.ativo || u.papel === "VENDEDOR") return { ok: false as const, erro: `${u.email} precisa ser ADMIN ou GESTOR ativo.` };
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
  try {
    conteudo = decodificarArquivo(io.ler(arquivo));
    if (a.args.mapa) mapeamento = JSON.parse(new TextDecoder().decode(io.ler(a.args.mapa)));
  } catch (e) {
    io.erro(`Não consegui ler ${(e as { path?: string }).path ?? a.args.mapa ?? arquivo}: ${(e as Error).message}`);
    return 1;
  }
  const quem = await quemImporta(a.args.usuario ?? io.env?.IMPORT_USUARIO_EMAIL);
  if (!quem.ok) {
    io.erro(quem.erro);
    return 1;
  }

  const r = await calcularPrevia(conteudo, { nomeArquivo: arquivo, mapeamento });
  if (!r.ok) {
    io.erro(r.erro);
    return 1;
  }
  const p = r.previa;
  const porId = new Map(p.fasesCrm.map((f) => [f.id, f]));
  io.log(`arquivo: ${arquivo} (separador "${p.separador}", ${p.totalLinhas} linhas)`);
  io.log(`cards: ${p.cards} — novos ${p.novos}, já existem ${p.existentes}, repetidos ${p.duplicadas}, com projeto ${p.comProjeto}, com erro ${p.erros.length}`);
  io.log("mapeamento de fases (chave do Pipefy → fase do CRM):");
  for (const f of p.fases) {
    const d = f.faseId ? porId.get(f.faseId) : undefined;
    io.log(`  ${JSON.stringify(f.chave)} (${f.cardsAtuais}) → ${d ? `${d.pipelineNome} / ${d.nome} [${d.id}]` : "SEM CORRESPONDÊNCIA"}`);
  }
  if (p.responsaveisSemMatch.length) {
    io.log(`responsáveis sem usuário (ficam com ${quem.usuario.email} + revisar): ${p.responsaveisSemMatch.map((x) => `${x.nome} (${x.cards})`).join(", ")}`);
  }

  if (!confirmar) {
    salvarOcorrencias(io, arquivo, p.erros, p.avisos);
    io.log("dry-run: nada foi gravado. Rode de novo com --confirmar para importar.");
    return 0;
  }

  const imp = await importarConteudo(conteudo, r.mapeamento, quem.usuario, agora);
  if (!imp.ok) {
    io.erro(imp.erro);
    return 1;
  }
  const rel = imp.relatorio;
  io.log(`import concluído: criados ${rel.criados}, atualizados ${rel.atualizados} (sem mudança ${rel.semMudanca}), pulados ${rel.pulados}, projetos criados ${rel.projetosCriados}`);
  salvarOcorrencias(io, arquivo, rel.erros, rel.avisos);
  return 0;
}
