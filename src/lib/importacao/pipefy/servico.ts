/**
 * Import do Pipefy, ponta a ponta (GAB-37): prévia → confirmação. Usado pela
 * tela Gestão → Importar e pelo CLI (`pnpm import:pipefy`). Permissão
 * (GESTOR+) é do chamador.
 *
 * Nada é gravado sem confirmação. A prévia guarda o CSV e o mapeamento de
 * fases em `import_previa` com `hash = sha256(conteúdo + mapeamento)`;
 * confirmar recebe token + hash, confere dono/validade/uso único e recalcula
 * o hash — o que é aplicado é exatamente o que o gestor viu.
 */
import { createHash, randomBytes } from "node:crypto";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { resolverContatos } from "@/lib/contatos/match";
import { PIPELINE_PROJETOS, PIPELINE_VENDAS } from "@/lib/oportunidades/terminal-regras";
import { aplicarCards, type GanchosTeste, type Relatorio } from "./aplicar";
import { opcoesCanonicas, validarOpcoes, type OpcoesImport } from "./opcoes";
import { emLotes } from "./lotes";
import { interpretarCsv, type Interpretacao, type Ocorrencia } from "./interpretar";
import type { Aliases } from "./colunas";
import { canonico, mapeamentoPadrao, resolverResponsavel, validarMapeamento, type FaseCrm, type Mapeamento } from "./mapeamento";

/** Teto do arquivo. O `proxy` do Next bufferiza até 10 MB por request; a action aceita 9 MB. */
export const LIMITE_BYTES = 8 * 1024 * 1024;
export const VALIDADE_PREVIA_MS = 30 * 60 * 1000;

export type Previa = {
  nomeArquivo: string;
  hash: string;
  separador: string;
  totalLinhas: number;
  cards: number;
  novos: number;
  existentes: number;
  duplicadas: number;
  /** Cards que geram (ou já têm) card em Projetos: ganho em Vendas ou fase de Projetos. */
  comProjeto: number;
  /** Cards que entram em PERDIDO sem "Motivo da perda" no CSV (erro, salvo motivo padrão escolhido). */
  perdidosSemMotivo: number;
  opcoes: OpcoesImport;
  fases: { chave: string; nome: string; cardsAtuais: number; faseId: string | null }[];
  fasesCrm: FaseCrm[];
  responsaveisSemMatch: { nome: string; cards: number }[];
  erros: Ocorrencia[];
  avisos: Ocorrencia[];
  colunasReconhecidas: string[];
  colunasHistorico: number;
  colunasIgnoradas: string[];
};

export type ResultadoPrevia =
  | { ok: true; previa: Previa; interpretacao: Interpretacao; mapeamento: Mapeamento; opcoes: OpcoesImport }
  | { ok: false; erro: string };

export function hashPrevia(conteudo: string, m: Mapeamento, o: OpcoesImport = {}): string {
  return createHash("sha256").update(conteudo).update("\0").update(canonico(m)).update("\0").update(opcoesCanonicas(o)).digest("hex");
}

export async function listarFasesCrm(): Promise<FaseCrm[]> {
  const fases = await db.fase.findMany({
    where: { arquivadaEm: null, pipeline: { chave: { in: [PIPELINE_VENDAS, PIPELINE_PROJETOS] } } },
    orderBy: [{ pipeline: { ordem: "asc" } }, { ordem: "asc" }, { criadoEm: "asc" }],
    select: { id: true, chave: true, nome: true, tipoTerminal: true, pipeline: { select: { chave: true, nome: true } } },
  });
  return fases.map((f) => ({ id: f.id, chave: f.chave, nome: f.nome, tipoTerminal: f.tipoTerminal, pipelineChave: f.pipeline.chave, pipelineNome: f.pipeline.nome }));
}

/** Prévia sem gravar nada (nem a `import_previa`): o CLI em dry-run usa direto. */
export async function calcularPrevia(
  conteudo: string,
  opts: { nomeArquivo: string; mapeamento?: unknown; aliases?: Aliases; opcoes?: unknown },
): Promise<ResultadoPrevia> {
  const op = validarOpcoes(opts.opcoes);
  if (!op.ok) return op;
  const opcoes = op.opcoes;
  const interp = interpretarCsv(conteudo, { aliases: opts.aliases });
  if (!interp.ok) return interp;
  const fasesCrm = await listarFasesCrm();
  let mapeamento: Mapeamento;
  if (opts.mapeamento === undefined) mapeamento = mapeamentoPadrao(interp.fases, fasesCrm);
  else {
    const v = validarMapeamento(opts.mapeamento, interp.fases, fasesCrm);
    if (!v.ok) return v;
    mapeamento = v.mapeamento;
  }
  const porId = new Map(fasesCrm.map((f) => [f.id, f]));

  const ids = interp.cards.map((c) => c.pipefyId);
  const existentes = new Map(
    (await emLotes(ids, (lote) => db.oportunidade.findMany({ where: { pipefyId: { in: lote } }, select: { pipefyId: true, deletadoEm: true, contatoId: true, faseId: true } }))).map((o) => [
      o.pipefyId!,
      o,
    ]),
  );
  const usuarios = await db.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, select: { id: true, nome: true, email: true } });

  // Pontos de contato que caem num contato excluído (lote: uma query + resolução de merges).
  const valores = [...new Set(interp.cards.flatMap((c) => c.pontos.map((p) => p.valorNormalizado)))];
  const pontos = await emLotes(valores, (lote) => db.contatoPonto.findMany({ where: { valorNormalizado: { in: lote } }, select: { tipo: true, valorNormalizado: true, contatoId: true } }));
  const donos = new Map(
    (await emLotes([...new Set(pontos.map((p) => p.contatoId))], async (lote) => [...(await resolverContatos(lote)).entries()])),
  );
  const bloqueados = new Set(pontos.filter((p) => !donos.get(p.contatoId) || donos.get(p.contatoId)!.deletado).map((p) => `${p.tipo}:${p.valorNormalizado}`));

  const erros: Ocorrencia[] = [...interp.erros];
  const semMatch = new Map<string, number>();
  const nomesFase = new Map(interp.fases.map((f) => [f.chave, f.nome]));
  let novos = 0;
  let nExistentes = 0;
  let comProjeto = 0;
  let perdidosSemMotivo = 0;
  for (const c of interp.cards) {
    const erro = (mensagem: string) => erros.push({ linha: c.linha, pipefyId: c.pipefyId, mensagem });
    const ex = existentes.get(c.pipefyId);
    const destino = mapeamento[c.faseAtual] ? porId.get(mapeamento[c.faseAtual]!) : undefined;
    if (!destino) {
      erro(`Fase "${nomesFase.get(c.faseAtual) ?? c.faseAtual}" sem correspondência no CRM (mapeie abaixo).`);
      continue;
    }
    if (ex?.deletadoEm) {
      erro("Card excluído no CRM (está na lixeira): não é reimportado.");
      continue;
    }
    const bloq = !ex?.contatoId ? c.pontos.find((p) => bloqueados.has(`${p.tipo}:${p.valorNormalizado}`)) : undefined;
    if (bloq) {
      erro(`Contato excluído na lixeira (${bloq.valorOriginal}). Restaure ou mescle o contato e importe de novo.`);
      continue;
    }
    // Só precisa de motivo quem ENTRA no perdido (já estar lá não chama o gancho).
    if (destino.tipoTerminal === "PERDIDO" && !c.motivoPerda?.trim() && ex?.faseId !== destino.id) {
      perdidosSemMotivo++;
      if (!opcoes.motivoPerdaPadrao) {
        erro("PERDIDO sem motivo no export.");
        continue;
      }
    }
    if (ex) nExistentes++;
    else novos++;
    if (destino.pipelineChave === PIPELINE_PROJETOS || (destino.pipelineChave === PIPELINE_VENDAS && destino.tipoTerminal === "GANHO")) comProjeto++;
    if (!resolverResponsavel(c.responsavel, usuarios)) {
      const nome = c.responsavel ?? "(sem responsável)";
      semMatch.set(nome, (semMatch.get(nome) ?? 0) + 1);
    }
  }
  erros.sort((a, b) => a.linha - b.linha);

  const previa: Previa = {
    nomeArquivo: opts.nomeArquivo,
    hash: hashPrevia(conteudo, mapeamento, opcoes),
    separador: interp.separador,
    totalLinhas: interp.totalLinhas,
    cards: interp.cards.length,
    novos,
    existentes: nExistentes,
    duplicadas: interp.duplicadas,
    comProjeto,
    perdidosSemMotivo,
    opcoes,
    fases: interp.fases.map((f) => ({ ...f, faseId: mapeamento[f.chave] })),
    fasesCrm,
    responsaveisSemMatch: [...semMatch.entries()].map(([nome, cards]) => ({ nome, cards })).sort((a, b) => b.cards - a.cards || a.nome.localeCompare(b.nome)),
    erros,
    avisos: interp.avisos,
    colunasReconhecidas: interp.colunasReconhecidas,
    colunasHistorico: interp.colunasHistorico,
    colunasIgnoradas: interp.colunasIgnoradas,
  };
  return { ok: true, previa, interpretacao: interp, mapeamento, opcoes };
}

export type PreviaSalva = { token: string; expiraEm: Date; previa: Previa };

/** Calcula a prévia e guarda (CSV + mapeamento) para a confirmação. Limpa prévias vencidas. */
export async function criarPrevia(
  dados: { conteudo: string; nomeArquivo: string; mapeamento?: unknown; opcoes?: unknown },
  por: { id: string },
  agora = new Date(),
): Promise<({ ok: true } & PreviaSalva) | { ok: false; erro: string }> {
  const r = await calcularPrevia(dados.conteudo, { nomeArquivo: dados.nomeArquivo, mapeamento: dados.mapeamento, opcoes: dados.opcoes });
  if (!r.ok) return r;
  await db.importPrevia.deleteMany({ where: { OR: [{ expiraEm: { lt: agora } }, { usuarioId: por.id, usadaEm: null }] } });
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(agora.getTime() + VALIDADE_PREVIA_MS);
  await db.importPrevia.create({
    data: { id: token, usuarioId: por.id, hash: r.previa.hash, nomeArquivo: dados.nomeArquivo.slice(0, 255), conteudo: dados.conteudo, mapeamento: r.mapeamento, opcoes: r.opcoes, expiraEm },
  });
  return { ok: true, token, expiraEm, previa: r.previa };
}

/** Novo mapeamento/opções sobre o mesmo arquivo: nova prévia (novo token e hash). */
export async function remapearPrevia(token: string, mapeamento: unknown, por: { id: string }, agora = new Date(), opcoes?: unknown) {
  const p = await db.importPrevia.findFirst({ where: { id: token, usuarioId: por.id, usadaEm: null, expiraEm: { gt: agora } } });
  if (!p) return { ok: false as const, erro: ERRO_PREVIA };
  return criarPrevia({ conteudo: p.conteudo, nomeArquivo: p.nomeArquivo, mapeamento, opcoes }, por, agora);
}

const ERRO_PREVIA = "Prévia expirada ou já usada. Envie o arquivo de novo.";

/** Apaga prévias vencidas de qualquer usuário (o cron do GAB-41 também deve chamar). */
export async function purgarVencidas(agora = new Date()): Promise<number> {
  return (await db.importPrevia.deleteMany({ where: { expiraEm: { lt: agora } } })).count;
}

export type ResultadoImport = { ok: true; relatorio: Relatorio } | { ok: false; erro: string };

/** Aplica a prévia `token` se o `hash` for o que o gestor viu. Uso único. */
export async function confirmarPrevia(token: string, hash: string, por: { id: string }, agora = new Date()): Promise<ResultadoImport> {
  await purgarVencidas(agora);
  // Marca como usada ANTES de aplicar (atômico): duplo clique não roda o import duas vezes.
  const marcada = await db.importPrevia.updateMany({ where: { id: token, usuarioId: por.id, usadaEm: null, expiraEm: { gt: agora }, hash }, data: { usadaEm: agora } });
  if (marcada.count !== 1) return { ok: false, erro: ERRO_PREVIA };
  const p = await db.importPrevia.findUniqueOrThrow({ where: { id: token } });
  // O CSV (dados pessoais) não fica guardado depois de usado; a linha fica até vencer (auditoria do uso único).
  await db.importPrevia.update({ where: { id: token }, data: { conteudo: "" } });
  const mapeamento = p.mapeamento as Mapeamento;
  const opcoes = p.opcoes as OpcoesImport;
  if (hashPrevia(p.conteudo, mapeamento, opcoes) !== hash) return { ok: false, erro: ERRO_PREVIA };
  return importarConteudo(p.conteudo, mapeamento, por, agora, { opcoes });
}

export type ExtrasImport = { aliases?: Aliases; opcoes?: OpcoesImport; tamanhoLote?: number; ganchosTeste?: GanchosTeste };

/** CSV + mapeamento já validados → banco. O CLI com `--confirmar` chama direto. */
export async function importarConteudo(conteudo: string, mapeamento: unknown, por: { id: string }, agora = new Date(), extras: ExtrasImport = {}): Promise<ResultadoImport> {
  const r = await calcularPrevia(conteudo, { nomeArquivo: "", mapeamento, aliases: extras.aliases, opcoes: extras.opcoes });
  if (!r.ok) return r;
  const interp = r.interpretacao;
  // Linhas que a prévia já recusa (fase sem mapa, perdido sem motivo, contato na lixeira…) não vão para o banco.
  const recusadas = new Set(r.previa.erros.map((e) => e.linha));
  const ap = await aplicarCards(
    interp.cards.filter((c) => !recusadas.has(c.linha)),
    {
      mapeamento: r.mapeamento,
      nomesFase: new Map(interp.fases.map((f) => [f.chave, f.nome])),
      admin: por,
      agora,
      opcoes: r.opcoes,
      tamanhoLote: extras.tamanhoLote,
      ganchosTeste: extras.ganchosTeste,
    },
  );
  const relatorio: Relatorio = {
    ...ap,
    total: interp.cards.length,
    duplicadas: interp.duplicadas,
    pulados: ap.pulados + r.previa.erros.length,
    erros: [...r.previa.erros, ...ap.erros].sort((a, b) => a.linha - b.linha),
    avisos: [...interp.avisos, ...ap.avisos].sort((a, b) => a.linha - b.linha),
  };
  return { ok: true, relatorio };
}
