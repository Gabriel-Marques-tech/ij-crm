/**
 * Aplica a extração da LLM no CRM (design doc §4.3 passo 8) — tudo numa
 * transação que o chamador abre (`processar.ts`). Este arquivo faz o `CRIAR`;
 * `ATUALIZAR` (ou reply a uma confirmação do bot) vai para `atualizar.ts`
 * (GAB-38); `IGNORAR` vai para `PENDENTE_REVISAO`.
 *
 * Duas fases: PLANO (só leitura; decide e pode desistir com PENDENTE sem ter
 * gravado nada) e ESCRITA. Regras de identidade (contrato de GAB-31):
 * - Identidade vem do TEXTO, não do que a LLM ecoa: os telefones/emails
 *   achados por regex (`citados`) decidem o contato. Exatamente um dono vivo
 *   → reaproveita; donos diferentes → PENDENTE (IDENTIFICADORES_CONFLITANTES);
 *   ponto de contato excluído (`BLOQUEADO_EXCLUIDO`) → PENDENTE, nunca cria.
 *   Os pontos gravados são os citados no texto (o que a LLM devolve e não
 *   está no texto é descartado).
 * - Empresa do contato reaproveitado (cadeia exata, não match por nome) é
 *   vinculada, resolvendo merge até a principal viva; se o nome que a LLM
 *   leu difere (sem acento/caixa) do cadastrado → revisar.
 * - Empresa vinculada automaticamente SÓ por CNPJ (`encontrarEmpresa` →
 *   `via: "cnpj"`). Domínio do email é SUGESTÃO: vai para `sugestoes` e
 *   marca `revisar`, sem vincular. Nome igual a um cadastro existente também
 *   é só sugestão (nunca match por nome).
 * - ids que a LLM devolve só valem se estão entre os candidatos exatos.
 * - Fase pela chave; terminal é recusada (ganho/perdido só por movimento,
 *   como em `criarCard`) → `primeiro_contato` + revisar.
 * - Responsável = remetente; `responsavel_nome` só troca com match exato
 *   (sem acento/caixa) do nome completo de UM usuário ativo.
 * - Motivos de revisão vão para o grupo: nunca ecoam texto livre da LLM
 *   (fase/responsável viram frase fixa).
 */
import type { Prisma } from "@prisma/client";
import { encontrarContatoPorIdentificador, encontrarEmpresa, resolverEmpresas } from "@/lib/contatos/match";
import { validarNome } from "@/lib/entidades/campos";
import { travarPipelines } from "@/lib/fases/fases";
import { ehDominioPublico, normalizarDominio } from "@/lib/normalizacao";
import { ErroDeRegra } from "@/lib/projetos/erros";
import { criarCardTravado } from "@/lib/projetos/projetos";
import { PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import { aplicarAtualizacao, pipelinesParaTravar } from "./atualizar";
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
import { extrairIdentificadores } from "./identificadores";

export type { Desfecho, EntradaAplicacao, Sugestao } from "./comum";
export { FASE_PADRAO_CRIAR, nomeComparavel } from "./comum";

export async function aplicarExtracao(tx: Tx, e: EntradaAplicacao): Promise<Desfecho> {
  const ex = e.extracao;
  if (ex.intencao === "IGNORAR") return pendente("IGNORAR");
  if (e.respostaInvalida) return pendente(e.respostaInvalida);
  // Reply a uma confirmação do bot fixa o card: é atualização mesmo que a LLM diga CRIAR.
  const atualizar = ex.intencao === "ATUALIZAR" || !!e.alvoResposta;

  const motivos: string[] = [];
  const sugestoes: Sugestao[] = [];

  // ---- lock primeiro, tudo de uma vez (ordem global por id): vendas e, se
  // a atualização pode ganhar o card, projetos (o gancho de ganho cria lá).
  const travar = atualizar ? await pipelinesParaTravar(tx, ex.fase_chave) : [PIPELINE_VENDAS];
  const pipes = await tx.pipeline.findMany({ where: { chave: { in: travar } }, select: { id: true, chave: true } });
  const vendas = pipes.find((p) => p.chave === PIPELINE_VENDAS);
  if (!vendas || pipes.length !== travar.length || !(await travarPipelines(tx, pipes.map((p) => p.id)))) throw new ErroDeRegra("PIPELINE_NAO_ENCONTRADO");
  if (atualizar) return aplicarAtualizacao(tx, e, { vendasId: vendas.id, travados: travar });

  // ---- PLANO: contato
  const ids = extrairIdentificadores(e.mensagem.texto);
  const citados = new Set([...ids.telefones, ...ids.emails]);
  const candidatosContato = new Map<string, { id: string; nome: string; empresaId: string | null }>();
  const donoDoPonto = new Map<string, string>();
  for (const valor of citados) {
    const m = await encontrarContatoPorIdentificador(valor, tx);
    if (m.tipo === "BLOQUEADO_EXCLUIDO") return pendente("CONTATO_EXCLUIDO");
    if (m.tipo === "ENCONTRADO") {
      candidatosContato.set(m.contato.id, m.contato);
      donoDoPonto.set(valor, m.contato.id);
    }
  }
  const pontos = pontosCitados(ex, ids);
  const donos = new Set(donoDoPonto.values());
  if (donos.size > 1) return pendente("IDENTIFICADORES_CONFLITANTES");

  let contatoExistente: { id: string; nome: string; empresaId: string | null } | null = null;
  if (donos.size === 1) contatoExistente = candidatosContato.get([...donos][0])!;
  else if (ex.contato.id && candidatosContato.has(ex.contato.id)) contatoExistente = candidatosContato.get(ex.contato.id)!;
  else if (ex.contato.id) motivos.push("contato indicado pela leitura não confere com o CRM");

  const nomeContatoNovo = !contatoExistente && ex.contato.nome ? validarNome(ex.contato.nome) : null;

  // ---- PLANO: empresa (vínculo automático só por CNPJ)
  const porCnpj = new Map<string, { id: string; nome: string }>();
  let cnpjLivre: string | null = null;
  for (const cnpj of ids.cnpjs) {
    const m = await encontrarEmpresa(cnpj, tx);
    if (m?.via === "cnpj") porCnpj.set(m.empresa.id, m.empresa);
    else if (await tx.empresa.findUnique({ where: { cnpj }, select: { id: true } })) return pendente("EMPRESA_EXCLUIDA");
    else cnpjLivre ??= cnpj;
  }
  if (porCnpj.size > 1) return pendente("IDENTIFICADORES_CONFLITANTES");

  let empresaExistente: { id: string; nome: string } | null = porCnpj.size === 1 ? [...porCnpj.values()][0] : null;
  if (!empresaExistente && ex.empresa.id) {
    motivos.push("empresa indicada pela leitura não confere por CNPJ");
  }
  if (!empresaExistente && contatoExistente?.empresaId) {
    const fim = (await resolverEmpresas([contatoExistente.empresaId], tx)).get(contatoExistente.empresaId);
    if (fim && !fim.deletado) {
      empresaExistente = { id: fim.id, nome: fim.nome };
      if (ex.empresa.nome && nomeComparavel(ex.empresa.nome) !== nomeComparavel(fim.nome)) {
        motivos.push("empresa da mensagem difere da empresa do contato");
      }
    }
  }
  const nomeEmpresaNova = !empresaExistente && ex.empresa.nome ? validarNome(ex.empresa.nome) : null;

  // Domínio de email citado: sugestão, nunca vínculo.
  for (const email of ids.emails) {
    const m = await encontrarEmpresa(email, tx);
    if (m?.via === "dominio" && m.empresa.id !== empresaExistente?.id && !sugestoes.some((s) => "empresaId" in s && s.empresaId === m.empresa.id)) {
      sugestoes.push({ tipo: "EMPRESA_POR_DOMINIO", empresaId: m.empresa.id, nome: m.empresa.nome });
      motivos.push(`empresa “${m.empresa.nome}” sugerida pelo domínio do email`);
    }
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

  if (!contatoExistente && !nomeContatoNovo && !empresaExistente && !nomeEmpresaNova) return pendente("SEM_NOME");

  // ---- PLANO: fase
  const fases = await tx.fase.findMany({
    where: { pipelineId: vendas.id, arquivadaEm: null },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: { id: true, chave: true, nome: true, isTerminal: true },
  });
  let fase = ex.fase_chave ? fases.find((f) => f.chave === ex.fase_chave) : undefined;
  if (fase?.isTerminal) {
    motivos.unshift("fechamento (ganho/perdido) só pelo CRM");
    fase = undefined;
  } else if (ex.fase_chave && !fase) {
    motivos.push("fase indicada não reconhecida");
  }
  fase ??= fases.find((f) => f.chave === FASE_PADRAO_CRIAR && !f.isTerminal) ?? fases.find((f) => !f.isTerminal);
  if (!fase) throw new ErroDeRegra("FASE_NAO_ENCONTRADA");

  // ---- PLANO: responsável
  const quem = await remetenteEResponsavel(tx, ex, e.mensagem.remetenteUsuarioId, motivos);
  const remetente = quem.remetente;
  const responsavel = quem.responsavel ?? remetente;

  // ---- PLANO: campos
  const { campos, proximaAcaoEm } = interpretarCamposExtracao(ex, e.mensagem.recebidaEm, motivos, e.mensagem.texto);
  if (ex.confianca < e.limiar) motivos.push("confiança baixa da leitura");
  const revisar = motivos.length > 0;

  // ---- ESCRITA
  let empresa: { id: string; nome: string; criada: boolean } | null = empresaExistente ? { ...empresaExistente, criada: false } : null;
  if (!empresa && nomeEmpresaNova) {
    const dominio = ex.contato.email ? normalizarDominio(ex.contato.email) : null;
    const nova = await tx.empresa.create({
      data: { nome: nomeEmpresaNova, cnpj: cnpjLivre, dominioEmail: dominio && !ehDominioPublico(dominio) ? dominio : null },
      select: { id: true, nome: true },
    });
    empresa = { ...nova, criada: true };
  }

  let contato: { id: string; nome: string; criado: boolean } | null = null;
  if (contatoExistente) {
    contato = { id: contatoExistente.id, nome: contatoExistente.nome, criado: false };
    // Pontos acumulam: os citados que ainda não existem entram no contato reaproveitado.
    const novos = pontos.filter((p) => !donoDoPonto.has(p.valorNormalizado));
    if (novos.length) await tx.contatoPonto.createMany({ data: novos.map((p) => ({ contatoId: contatoExistente.id, ...p })) });
  } else if (nomeContatoNovo) {
    const novo = await tx.contato.create({
      data: { nome: nomeContatoNovo, empresaId: empresa?.id ?? null, pontos: { create: pontos } },
      select: { id: true, nome: true },
    });
    contato = { ...novo, criado: true };
  }

  const titulo = [contato?.nome, empresa?.nome].filter(Boolean).join(" — ");
  const agora = new Date();
  const projetoId = await criarCardTravado(
    tx,
    {
      pipelineId: vendas.id,
      faseId: fase.id,
      titulo,
      responsavelId: responsavel.id,
      via: "WHATSAPP",
      campos: { ...campos, empresaId: empresa?.id ?? null, contatoId: contato?.id ?? null, revisar },
      agora,
    },
    remetente,
  );
  await tx.timeline.create({
    data: {
      projetoId,
      tipo: "MENSAGEM_WHATSAPP",
      usuarioId: remetente.id,
      mensagemBrutaId: e.mensagem.id,
      em: new Date(agora.getTime() + 1),
      payload: { texto: e.mensagem.texto, ...e.registroLlm, motivosRevisar: motivos, sugestoes } as Prisma.InputJsonValue,
    },
  });

  return {
    tipo: "CRIADO",
    projetoId,
    contato: contato ? { id: contato.id, criado: contato.criado } : null,
    empresa: empresa ? { id: empresa.id, criada: empresa.criada } : null,
    sugestoes,
    titulo,
    faseNome: fase.nome,
    responsavelNome: responsavel.nome,
    proximaAcao: (campos.proximaAcao as string | undefined) ?? null,
    proximaAcaoEm,
    revisar,
    motivosRevisar: motivos,
  };
}
