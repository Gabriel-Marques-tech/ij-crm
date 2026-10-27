/**
 * `ATUALIZAR` pelo WhatsApp (GAB-38; design doc §4.3 "Alvo de ATUALIZAR").
 * Roda dentro da transação de `aplicarExtracao`, que já tomou os locks de
 * pipeline (vendas e, se a mensagem pode ganhar o card, projetos — ver
 * `pipelinesParaTravar`).
 *
 * PLANO (só leitura; pode desistir com PENDENTE sem gravar nada):
 * - Alvo: candidatas que foram no contexto, RELIDAS aqui (vivas, em vendas,
 *   fase atual) → `resolverAlvo`. Reply a confirmação fixa o card; id da
 *   LLM fora da lista é ignorado. Nenhum alvo → PENDENTE.
 * - Identidade, como no CRIAR: só identificadores citados no TEXTO.
 *   Telefone/email sem dono acumulam no contato do card; de outro contato →
 *   revisar (não rouba ponto). Card sem contato: dono único → vincula;
 *   senão nome lido → contato novo.
 * - Empresa: CNPJ citado vincula. Nome lido: card sem empresa → empresa do
 *   contato (se o nome bate) ou nova; card com empresa de outro nome → só
 *   troca numa CORREÇÃO (reply a confirmação), senão revisar.
 * - Fase pela chave. Terminal só com o dado obrigatório na mensagem (valor
 *   do ganho / motivo da perda); sem ele não move e marca revisar.
 * - Campos: só os que vieram (nunca apaga); origem só se o card não tinha.
 *
 * ESCRITA: Timeline MENSAGEM_WHATSAPP, vínculos (CAMPO_ALTERADO no formato do
 * `vincularAoCard`), movimento pelo núcleo (`registrarMovimento`, origem
 * WHATSAPP, ganchos de terminal) e campos por `aplicarPatch` (CAMPO_ALTERADO
 * só do que mudou). Card fechado como alvo → card NOVO com `reaberta_de_id`.
 */
import type { Fase, Prisma } from "@prisma/client";
import { encontrarContatoPorIdentificador, encontrarEmpresa, resolverContatos, resolverEmpresas } from "@/lib/contatos/match";
import { validarNome } from "@/lib/entidades/campos";
import { ehDominioPublico, normalizarDominio } from "@/lib/normalizacao";
import { ErroDeRegra } from "@/lib/oportunidades/erros";
import { aplicarPatch, criarCardTravado, registrarMovimento, type PatchCard } from "@/lib/oportunidades/oportunidades";
import { pipelinesExtrasDoTerminal } from "@/lib/oportunidades/terminal";
import { PIPELINE_VENDAS, type DadosTerminal } from "@/lib/oportunidades/terminal-regras";
import { resolverAlvo, type Candidata } from "./alvo";
import {
  FASE_PADRAO_CRIAR,
  VIVO,
  interpretarCamposExtracao,
  nomeComparavel,
  pendente,
  pontosCitados,
  remetenteEResponsavel,
  type Desfecho,
  type EntradaAplicacao,
  type Sugestao,
  type Tx,
} from "./comum";
import { dadosDoFechamento } from "./fechamento";
import { extrairIdentificadores } from "./identificadores";

type Ref = { id: string; nome: string };
type ContatoRef = Ref & { empresaId: string | null };

/**
 * Chaves dos pipelines a travar ANTES de tudo: vendas e, se `fase_chave` é
 * um terminal que escreve em outro quadro (ganho → projetos), esse também.
 * Lido antes do lock só para decidir o conjunto; `aplicarAtualizacao` recusa
 * (CONFLITO_CONCORRENTE) se depois do lock o conjunto não bastar.
 */
export async function pipelinesParaTravar(tx: Tx, faseChave: string | null): Promise<string[]> {
  if (!faseChave) return [PIPELINE_VENDAS];
  const f = await tx.fase.findFirst({ where: { chave: faseChave, pipeline: { chave: PIPELINE_VENDAS } }, select: { tipoTerminal: true } });
  return [PIPELINE_VENDAS, ...pipelinesExtrasDoTerminal(PIPELINE_VENDAS, f?.tipoTerminal ?? null)];
}

const tituloDe = (contato: string | null | undefined, empresa: string | null | undefined) => [contato, empresa].filter(Boolean).join(" — ");

async function contatoVivo(tx: Tx, id: string | null): Promise<ContatoRef | null> {
  if (!id) return null;
  const r = (await resolverContatos([id], tx)).get(id);
  if (!r || r.deletado) return null;
  return tx.contato.findUniqueOrThrow({ where: { id: r.id }, select: { id: true, nome: true, empresaId: true } });
}

async function empresaViva(tx: Tx, id: string | null): Promise<Ref | null> {
  if (!id) return null;
  const r = (await resolverEmpresas([id], tx)).get(id);
  return r && !r.deletado ? { id: r.id, nome: r.nome } : null;
}

/** Mesmo nome (sem acento/caixa); fora de correção, um contido no outro também conta ("Sensata" ~ "Economia Sensata"). */
function mesmaEmpresa(a: string, b: string, estrito: boolean): boolean {
  const x = nomeComparavel(a);
  const y = nomeComparavel(b);
  return x === y || (!estrito && (x.includes(y) || y.includes(x)));
}

export async function aplicarAtualizacao(tx: Tx, e: EntradaAplicacao, locks: { vendasId: string; travados: string[] }): Promise<Desfecho> {
  const ex = e.extracao;
  const motivos: string[] = [];
  const sugestoes: Sugestao[] = [];
  const alvoResposta = e.alvoResposta ?? null;

  // ---- PLANO: alvo (candidatas relidas depois do lock)
  const enviadas = new Map((e.candidatas ?? []).map((c) => [c.id, c]));
  if (alvoResposta && !enviadas.has(alvoResposta)) enviadas.set(alvoResposta, { id: alvoResposta, tocadaEm: new Date(0), via: ["resposta"] });
  const vivas = enviadas.size
    ? await tx.oportunidade.findMany({
        where: { id: { in: [...enviadas.keys()] }, pipelineId: locks.vendasId, deletadoEm: null },
        select: { id: true, fase: { select: { isTerminal: true } } },
      })
    : [];
  const candidatas: Candidata[] = vivas.map((v) => ({ ...enviadas.get(v.id)!, terminal: v.fase.isTerminal }));
  const alvo = resolverAlvo({ alvoResposta, escolhaLlm: ex.oportunidade_id, candidatas });
  if (alvo.tipo === "NENHUM") return pendente("ALVO_NAO_ENCONTRADO");
  motivos.push(...alvo.motivos);
  const reabrir = alvo.tipo === "REABRIR";
  const baseId = alvo.tipo === "EXISTENTE" ? alvo.id : alvo.deId;
  const correcao = !reabrir && alvoResposta !== null && baseId === alvoResposta;

  if (!reabrir) {
    // Linha do card travada desde já: o "antes" de vínculos e campos é o real.
    const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${baseId} AND deletado_em IS NULL FOR UPDATE`;
    if (travado.length === 0) throw new ErroDeRegra("CARD_NAO_ENCONTRADO");
  }
  const base = await tx.oportunidade.findUniqueOrThrow({
    where: { id: baseId },
    select: { id: true, titulo: true, faseId: true, origem: true, responsavelId: true, contatoId: true, empresaId: true },
  });

  // ---- PLANO: contato (identidade só do texto)
  const ids = extrairIdentificadores(e.mensagem.texto);
  const donoDoPonto = new Map<string, string>();
  const achados = new Map<string, ContatoRef>();
  for (const valor of [...ids.telefones, ...ids.emails]) {
    const m = await encontrarContatoPorIdentificador(valor, tx);
    if (m.tipo === "BLOQUEADO_EXCLUIDO") return pendente("CONTATO_EXCLUIDO");
    if (m.tipo === "ENCONTRADO") {
      achados.set(m.contato.id, m.contato);
      donoDoPonto.set(valor, m.contato.id);
    }
  }
  const pontos = pontosCitados(ex, ids).filter((p) => !donoDoPonto.has(p.valorNormalizado));
  const donos = new Set(donoDoPonto.values());

  const contatoAtual = await contatoVivo(tx, base.contatoId);
  let contatoFinal: ContatoRef | null = contatoAtual;
  let nomeContatoNovo: string | null = null;
  if (contatoAtual) {
    if ([...donos].some((d) => d !== contatoAtual.id)) motivos.push("telefone/email da mensagem é de outro contato do CRM");
  } else if (donos.size > 1) {
    return pendente("IDENTIFICADORES_CONFLITANTES");
  } else if (donos.size === 1) {
    contatoFinal = achados.get([...donos][0])!;
  } else if (ex.contato.nome) {
    nomeContatoNovo = validarNome(ex.contato.nome);
  }

  // ---- PLANO: empresa (CNPJ vincula; nome só cria/troca nas regras acima)
  const porCnpj = new Map<string, Ref>();
  let cnpjLivre: string | null = null;
  for (const cnpj of ids.cnpjs) {
    const m = await encontrarEmpresa(cnpj, tx);
    if (m?.via === "cnpj") porCnpj.set(m.empresa.id, m.empresa);
    else if (await tx.empresa.findUnique({ where: { cnpj }, select: { id: true } })) return pendente("EMPRESA_EXCLUIDA");
    else cnpjLivre ??= cnpj;
  }
  if (porCnpj.size > 1) return pendente("IDENTIFICADORES_CONFLITANTES");

  const empresaAtual = await empresaViva(tx, base.empresaId);
  let empresaFinal: Ref | null = empresaAtual;
  let nomeEmpresaNova: string | null = null;
  const nomeLido = ex.empresa.nome ? validarNome(ex.empresa.nome) : null;
  if (porCnpj.size === 1) {
    empresaFinal = [...porCnpj.values()][0];
  } else if (nomeLido && empresaAtual) {
    if (!mesmaEmpresa(nomeLido, empresaAtual.nome, correcao)) {
      if (correcao) nomeEmpresaNova = nomeLido;
      else motivos.push("empresa da mensagem difere da empresa do card");
    }
  } else if (!empresaAtual) {
    const doContato = await empresaViva(tx, contatoFinal?.empresaId ?? null);
    if (nomeLido && !(doContato && mesmaEmpresa(nomeLido, doContato.nome, false))) nomeEmpresaNova = nomeLido;
    else empresaFinal = doContato;
  }
  if (nomeEmpresaNova) {
    const igual = await tx.empresa.findFirst({ where: { ...VIVO, nome: { equals: nomeEmpresaNova, mode: "insensitive" } }, select: { id: true, nome: true } });
    if (igual) {
      sugestoes.push({ tipo: "EMPRESA_MESMO_NOME", empresaId: igual.id, nome: igual.nome });
      motivos.push("já existe empresa com esse nome no CRM");
    }
  }
  if (nomeContatoNovo) {
    const igual = await tx.contato.findFirst({ where: { ...VIVO, nome: { equals: nomeContatoNovo, mode: "insensitive" } }, select: { id: true, nome: true } });
    if (igual) {
      sugestoes.push({ tipo: "CONTATO_MESMO_NOME", contatoId: igual.id, nome: igual.nome });
      motivos.push("já existe contato com esse nome no CRM");
    }
  }

  // ---- PLANO: fase
  const fases = await tx.fase.findMany({ where: { pipelineId: locks.vendasId, arquivadaEm: null }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  const faseAtual = await tx.fase.findUniqueOrThrow({ where: { id: base.faseId } });
  let destino: Fase | undefined = ex.fase_chave ? fases.find((f) => f.chave === ex.fase_chave) : undefined;
  if (ex.fase_chave && !destino) motivos.push("fase indicada não reconhecida");
  let dadosTerminal: DadosTerminal | undefined;
  if (destino?.isTerminal) {
    const d = dadosDoFechamento(destino, ex.campos);
    if (!d.ok) {
      motivos.unshift(d.motivo);
      destino = undefined;
    } else if (reabrir) {
      motivos.push("fechamento de card reaberto só pelo CRM");
      destino = undefined;
    } else {
      // O conjunto travado antes do lock tem de cobrir o gancho deste terminal.
      if (pipelinesExtrasDoTerminal(PIPELINE_VENDAS, destino.tipoTerminal).some((p) => !locks.travados.includes(p))) {
        throw new ErroDeRegra("CONFLITO_CONCORRENTE");
      }
      dadosTerminal = d.dados;
    }
  }

  // ---- PLANO: responsável e campos
  const { remetente, responsavel } = await remetenteEResponsavel(tx, ex, e.mensagem.remetenteUsuarioId, motivos);
  const { campos, proximaAcaoEm } = interpretarCamposExtracao(ex, e.mensagem.recebidaEm, motivos);
  if (base.origem && !reabrir) delete campos.origem; // origem é histórico: só preenche vazio
  if (ex.confianca < e.limiar) motivos.push("confiança baixa da leitura");
  const revisar = motivos.length > 0;

  // ---- ESCRITA: empresa/contato
  if (nomeEmpresaNova) {
    const dominio = ex.contato.email ? normalizarDominio(ex.contato.email) : null;
    empresaFinal = await tx.empresa.create({
      data: { nome: nomeEmpresaNova, cnpj: cnpjLivre, dominioEmail: dominio && !ehDominioPublico(dominio) ? dominio : null },
      select: { id: true, nome: true },
    });
  }
  if (nomeContatoNovo) {
    contatoFinal = await tx.contato.create({
      data: { nome: nomeContatoNovo, empresaId: empresaFinal?.id ?? null, pontos: { create: pontos } },
      select: { id: true, nome: true, empresaId: true },
    });
  } else if (contatoFinal) {
    // Pontos acumulam (só os citados no texto e sem dono).
    const destinoPontos = contatoFinal.id;
    if (pontos.length) await tx.contatoPonto.createMany({ data: pontos.map((p) => ({ contatoId: destinoPontos, ...p })) });
    // Contato sem empresa (ou com a que o card acabou de trocar) segue a do card.
    if (empresaFinal && contatoFinal.empresaId !== empresaFinal.id && (!contatoFinal.empresaId || contatoFinal.empresaId === empresaAtual?.id)) {
      await tx.contato.update({ where: { id: contatoFinal.id }, data: { empresaId: empresaFinal.id } });
    }
  }

  const tituloAntigoAuto = base.titulo === tituloDe(contatoAtual?.nome, empresaAtual?.nome);
  const tituloNovo = tituloDe(contatoFinal?.nome, empresaFinal?.nome);
  const agora = new Date();
  const payloadMensagem = { texto: e.mensagem.texto, ...e.registroLlm, alvo: alvo.tipo, motivosRevisar: motivos, sugestoes } as Prisma.InputJsonValue;

  // ---- ESCRITA: card fechado → card novo reaberto
  if (reabrir) {
    const fase = (destino && !destino.isTerminal ? destino : undefined) ?? fases.find((f) => f.chave === FASE_PADRAO_CRIAR && !f.isTerminal) ?? fases.find((f) => !f.isTerminal);
    if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");
    const titulo = tituloAntigoAuto && tituloNovo ? tituloNovo : base.titulo;
    const resp = responsavel ?? remetente;
    const oportunidadeId = await criarCardTravado(
      tx,
      {
        pipelineId: locks.vendasId,
        faseId: fase.id,
        titulo,
        responsavelId: resp.id,
        via: "WHATSAPP",
        campos: { ...campos, empresaId: empresaFinal?.id ?? null, contatoId: contatoFinal?.id ?? null, reabertaDeId: base.id, revisar: true },
        agora,
      },
      remetente,
    );
    await tx.timeline.create({
      data: { oportunidadeId, tipo: "MENSAGEM_WHATSAPP", usuarioId: remetente.id, mensagemBrutaId: e.mensagem.id, em: new Date(agora.getTime() + 1), payload: payloadMensagem },
    });
    return {
      tipo: "CRIADO",
      oportunidadeId,
      reabertaDeId: base.id,
      contato: contatoFinal ? { id: contatoFinal.id, criado: !!nomeContatoNovo } : null,
      empresa: empresaFinal ? { id: empresaFinal.id, criada: !!nomeEmpresaNova } : null,
      sugestoes,
      titulo,
      faseNome: fase.nome,
      responsavelNome: resp.nome,
      proximaAcao: (campos.proximaAcao as string | undefined) ?? null,
      proximaAcaoEm,
      revisar: true,
      motivosRevisar: motivos,
    };
  }

  // ---- ESCRITA: card existente
  let t = agora.getTime();
  await tx.timeline.create({
    data: { oportunidadeId: base.id, tipo: "MENSAGEM_WHATSAPP", usuarioId: remetente.id, mensagemBrutaId: e.mensagem.id, em: new Date(t), payload: payloadMensagem },
  });

  const alterados: string[] = [];
  for (const [campo, antes, depois] of [
    ["contato", contatoAtual, contatoFinal],
    ["empresa", empresaAtual, empresaFinal],
  ] as const) {
    if ((antes?.id ?? null) === (depois?.id ?? null) || !depois) continue;
    await tx.oportunidade.update({ where: { id: base.id }, data: campo === "empresa" ? { empresaId: depois.id } : { contatoId: depois.id } });
    await tx.timeline.create({
      data: {
        oportunidadeId: base.id,
        tipo: "CAMPO_ALTERADO",
        payload: { campo, antes: antes?.nome ?? null, depois: depois.nome, antesId: antes?.id ?? null, depoisId: depois.id },
        usuarioId: remetente.id,
        em: new Date(++t),
      },
    });
    alterados.push(campo);
  }

  let deFaseNome: string | null = null;
  if (destino && destino.id !== faseAtual.id) {
    await registrarMovimento(tx, {
      oportunidadeId: base.id,
      pipelineChave: PIPELINE_VENDAS,
      origem: faseAtual,
      destino,
      porId: remetente.id,
      em: new Date(++t),
      origemTransicao: "WHATSAPP",
      via: "WHATSAPP",
      dadosTerminal,
    });
    t += 50; // espaço para as entradas dos ganchos de terminal (em + n ms)
    deFaseNome = faseAtual.nome;
  }

  const patch: PatchCard = {};
  for (const [k, v] of Object.entries(campos)) {
    if (v !== null && v !== undefined) (patch as Record<string, unknown>)[k] = v;
  }
  if (tituloAntigoAuto && tituloNovo && tituloNovo !== base.titulo) patch.titulo = tituloNovo;
  if (responsavel && responsavel.id !== base.responsavelId) patch.responsavelId = responsavel.id;
  if (revisar) patch.revisar = true; // nunca desmarca: limpar revisão é do CRM
  alterados.push(...(await aplicarPatch(tx, base.id, patch, remetente, t + 1)));

  const final = await tx.oportunidade.findUniqueOrThrow({ where: { id: base.id }, select: { titulo: true, fase: { select: { nome: true } } } });
  return {
    tipo: "ATUALIZADO",
    oportunidadeId: base.id,
    alterados,
    sugestoes,
    titulo: final.titulo,
    deFaseNome,
    faseNome: final.fase.nome,
    proximaAcao: (campos.proximaAcao as string | undefined) ?? null,
    proximaAcaoEm,
    mudou: alterados.length > 0 || deFaseNome !== null,
    revisar,
    motivosRevisar: motivos,
  };
}
