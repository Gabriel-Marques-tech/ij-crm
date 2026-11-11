/**
 * Ferramentas MCP de Projeto (GAB-83, spec fase 2 §4.13). Regra de construção:
 * cada ferramenta só traduz argumentos e chama a MESMA camada de serviço da
 * tela (`lib/projetos`, `lib/fases`) — nenhuma regra de negócio mora aqui.
 *
 * Permissão = a da tela: ferramenta de escrita recusa VISUALIZADOR antes de
 * chamar o serviço (como `exigirEscrita` nas actions), e o serviço ainda
 * confere o papel (`SEM_PERMISSAO`). Área do card e acesso à proposta (GAB-98):
 * `guarda` de cada ferramenta, na porta única. Ficam SÓ na tela: deleção definitiva,
 * merge de contatos e configuração técnica (não há ferramenta para elas).
 *
 * Tudo roda dentro de `comViaMcp`: a Timeline gravada sai marcada "via MCP".
 * Erro de regra → texto em português para o Claude; exceção → log com `ref`
 * e a mesma `ref` na mensagem (padrão do repo: `registrarErro`).
 *
 * Próximas fatias acrescentam ferramentas a `FERRAMENTAS`. Proposta (GAB-86):
 * ler/criar/editar (Markdown + parte estruturada), salvar versão e ler versões.
 * Caneta (GAB-87): passar, devolver, concordar, pegar, reabrir, inviável e diff —
 * as mesmas funções de serviço da tela, com a máquina de estados de propostas/caneta.ts.
 * Avisos (GAB-88): listar os do sino e marcar como lidos — sempre os da própria pessoa.
 * Contrato (GAB-99): marcar assinado, com o PDF opcional.
 * Handoff (GAB-93): ler, itens, resumo, GP, PDF do contrato e mover para execução.
 * Execução (GAB-95): cronograma, entregas e check-in, em ./execucao.ts.
 */
import { z } from "zod";
import { lerTextoDoAnexo, listarAnexos } from "@/lib/anexos/anexos";
import { ROTULO_TIPO_ANEXO } from "@/lib/anexos/tipos";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { podeEscrever } from "@/lib/auth/papeis";
import { comViaMcp } from "@/lib/canal";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";
import { listarPipelines } from "@/lib/fases/fases";
import { ROTULO_MARCO } from "@/lib/fases/marcos";
import { diaEmFuso } from "@/lib/projetos/aging";
import { MENSAGEM_ERRO_CONTRATO, marcarContratoAssinado } from "@/lib/projetos/contrato-assinado";
import { CAMPOS_EDITAVEIS, descricaoSchema, interpretarCampo, type CampoEditavel } from "@/lib/projetos/campos";
import { MENSAGEM_ERRO_PROJETO, textoDoErroProjeto } from "@/lib/projetos/erros";
import {
  anexarContratoNoHandoff,
  definirContratoNoHandoff,
  designarGpDoProjeto,
  listarCandidatosGp,
  marcarItemHandoff,
  MENSAGEM_ERRO_HANDOFF,
  moverParaExecucao,
  obterHandoff,
  salvarResumoHandoff,
} from "@/lib/projetos/handoff";
import { descreverPendencias, ITENS_MANUAIS, RESUMO_CAMPO_MAX } from "@/lib/projetos/handoff-regras";
import { adicionarNota, criarCard, editarCard, listarQuadro, listarResponsaveis, moverCard, obterCard, type PatchCard } from "@/lib/projetos/projetos";
import { MOTIVOS_PERDA, PIPELINE_PROJETOS, PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import { vincularAoCard } from "@/lib/projetos/vinculos";
import { buscarContatosPorNome } from "@/lib/contatos/contatos";
import { buscarEmpresasPorNome } from "@/lib/empresas/empresas";
import { MENSAGEM_VINCULO } from "@/lib/entidades/mensagens";
import { mensagemFalhaPrazo } from "@/lib/prazos/mensagens";
import { criarPrazo, listarPrazosDoCard, marcarPrazoFeito } from "@/lib/prazos/prazos";
import { carregarPainelPara, INDICADORES } from "@/lib/painel/servico";
import { DEFINICOES_PAINEL, VISIBILIDADE_PAINEL } from "@/lib/painel/definicoes";
import { resolverPeriodo } from "@/lib/ranking/periodo";
import { MARKDOWN_MAX } from "@/lib/propostas/documento";
import { DURACAO_MAX_CAMPO, estruturadoParaEntrada, type Estruturado, type EstruturadoEntrada } from "@/lib/propostas/estruturado";
import { acoesPossiveis, ladoDaCaneta, MOTIVO_INVIAVEL_MAX, podeEditarProposta, type AcaoCaneta } from "@/lib/propostas/caneta";
import { diffParaTexto } from "@/lib/propostas/diff";
import { acoesDeEnvio, PEDIDO_REVISAO_MAX, type AcaoEnvio } from "@/lib/propostas/envio";
import { urlPdfDaProposta } from "@/lib/propostas/url";
import {
  concluirRevisao,
  concordarProposta,
  criarProposta,
  devolverProposta,
  diffDaProposta,
  listarPessoasDaCaneta,
  marcarEnviada,
  marcarInviavel,
  mensagemDaFalha,
  obterPropostaDoProjeto,
  obterVersao,
  passarCaneta,
  pegarCaneta,
  pessoaDaCaneta,
  reabrirProposta,
  registrarResposta,
  salvarRascunho,
  salvarVersao,
  versaoFinalDaProposta,
  type Falha,
} from "@/lib/propostas/propostas";
import { MENSAGEM_ERRO_PROPOSTA, NOTA_VERSAO_MAX, podeCriarProposta, ROTULO_STATUS_PROPOSTA } from "@/lib/propostas/regras";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { listarGpsDeProjetos } from "@/lib/avisos/handoff";
import { contarNaoLidos, LISTA_MAX, LISTA_PADRAO, listarAvisos, marcarLidos } from "@/lib/avisos/avisos";
import { recusaDeCriarNoQuadro } from "@/lib/projetos/acesso-card";
import { mascararMotivoInviavel, podeVerPropostaDoProjeto, timelineSemProposta } from "@/lib/propostas/acesso";
import { quadroPadrao } from "@/lib/auth/visibilidade";
import { FERRAMENTAS_COMENTARIOS } from "./comentarios";
import { FERRAMENTAS_EXECUCAO } from "./execucao";
import { FERRAMENTAS_PAINEL_PROJETOS } from "./painel-projetos";
import { camposEditaveis, cardEditavel, checklistHandoffEditavel, propostaVisivel } from "./guardas";
import type { UsuarioMcp } from "./oauth";
import { preencherPropostaDeAnexo } from "./preenchimento";
import { urlBase } from "./url";

export type Resposta = { ok: true; dados: unknown } | { ok: false; erro: string };

type Forma = z.ZodRawShape;

export type Ferramenta<F extends Forma = Forma> = {
  nome: string;
  titulo: string;
  descricao: string;
  /** Escreve no CRM: VISUALIZADOR (somente leitura) é recusado, como na tela. */
  escrita: boolean;
  /**
   * Grava algo mesmo não sendo escrita no CRM (ex.: marcar o próprio aviso como
   * lido): só tira o `readOnlyHint` do anúncio MCP; a permissão segue `escrita`.
   */
  muda?: boolean;
  /**
   * GAB-98: permissão que depende do dado (área do card, proposta), conferida na porta
   * única depois dos argumentos. `string` = recusa, e o serviço nem é chamado.
   */
  guarda?: (args: z.infer<z.ZodObject<F>>, eu: UsuarioMcp) => Promise<string | null>;
  entrada: F;
  executar: (args: z.infer<z.ZodObject<F>>, eu: UsuarioMcp) => Promise<Resposta>;
};

function ferramenta<F extends Forma>(f: Ferramenta<F>): Ferramenta {
  return f as unknown as Ferramenta;
}

export const SO_LEITURA = "Seu acesso no CRM é só de visualização: esta ação não é permitida para o seu papel.";

const id = z.string().min(1).max(64);
const quadro = z.enum([PIPELINE_VENDAS, PIPELINE_PROJETOS]);
const ok = (dados: unknown): Resposta => ({ ok: true, dados });
const erro = (texto: string): Resposta => ({ ok: false, erro: texto });
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const urlProjeto = (pid: string) => `${urlBase()}/projetos/${pid}`;
const dia = (d: Date | null) => (d ? diaEmFuso(d) : null);

/** Texto sem acento e minúsculo, para a busca por texto. */
function normalizar(t: string): string {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function mapaDeFases() {
  const ps = await listarPipelines({ incluirArquivadas: true });
  return new Map(ps.flatMap((p) => p.fases.map((f) => [f.id, { nome: f.nome, quadro: p.chave }] as const)));
}

// ---------------------------------------------------------------- leitura

const listarFases = ferramenta({
  nome: "listar_fases",
  titulo: "Listar quadros e fases",
  descricao:
    "Lista os quadros do CRM (vendas e projetos) com as fases ativas em ordem: id, nome, marco do ciclo (Proposta, Montando contrato, Ganho, Perdido, Handoff, Execução, Finalizado) e se é terminal. Use os ids para filtrar, criar e mover projetos. Inclui os motivos de perda aceitos.",
  escrita: false,
  entrada: {},
  executar: async () => {
    const ps = await listarPipelines();
    return ok({
      quadros: ps.map((p) => ({
        quadro: p.chave,
        nome: p.nome,
        fases: p.fases.map((f) => ({ id: f.id, nome: f.nome, marco: f.marco ? ROTULO_MARCO[f.marco] : null, terminal: f.tipoTerminal })),
      })),
      motivosDePerda: MOTIVOS_PERDA.map((m) => ({ chave: m.chave, rotulo: m.rotulo })),
    });
  },
});

const listarPessoas = ferramenta({
  nome: "listar_responsaveis",
  titulo: "Listar responsáveis",
  descricao: "Lista as pessoas ativas que podem ser responsáveis por um projeto (id e nome). Também diz quem é você.",
  escrita: false,
  entrada: {},
  executar: async (_args, eu) => ok({ voce: { id: eu.id, nome: eu.nome, papel: eu.papel }, responsaveis: await listarResponsaveis() }),
});

const LIMITE_PADRAO = 50;

const buscarProjetos = ferramenta({
  nome: "buscar_projetos",
  titulo: "Buscar projetos",
  descricao:
    "Lista/busca projetos (cards do Kanban) vivos. Filtros opcionais: quadro (vendas|projetos), fase_id, responsavel_id (ou \"eu\") e texto (no título ou na empresa, sem diferenciar acento). Mais recentes na fase primeiro.",
  escrita: false,
  entrada: {
    quadro: quadro.optional().describe("vendas ou projetos; sem ele, os dois"),
    fase_id: id.optional(),
    responsavel_id: id.optional().describe('id da pessoa, ou "eu"'),
    texto: z.string().max(200).optional(),
    limite: z.number().int().min(1).max(200).optional().describe(`padrão ${LIMITE_PADRAO}`),
  },
  executar: async (a, eu) => {
    const chaves = a.quadro ? [a.quadro] : [PIPELINE_VENDAS, PIPELINE_PROJETOS];
    const quadros = (await Promise.all(chaves.map((q) => listarQuadro(q)))).filter((q) => q !== null);
    const responsavel = a.responsavel_id === "eu" ? eu.id : a.responsavel_id;
    const texto = a.texto?.trim() ? normalizar(a.texto.trim()) : null;
    const achados = quadros.flatMap((q) =>
      q.cards
        .filter((c) => !a.fase_id || c.faseId === a.fase_id)
        .filter((c) => !responsavel || c.responsavel.id === responsavel)
        .filter((c) => !texto || normalizar(`${c.titulo} ${c.empresa?.nome ?? ""}`).includes(texto))
        .map((c) => ({
          id: c.id,
          titulo: c.titulo,
          quadro: q.pipeline.chave,
          fase: q.fases.find((f) => f.id === c.faseId)?.nome ?? null,
          faseId: c.faseId,
          naFaseDesde: c.faseDesde.toISOString(),
          responsavel: { id: c.responsavel.id, nome: c.responsavel.nome },
          empresa: c.empresa?.nome ?? null,
          proximaAcao: c.proximaAcao,
          proximaAcaoEm: dia(c.proximaAcaoEm),
          revisar: c.revisar,
          url: urlProjeto(c.id),
        })),
    );
    const limite = a.limite ?? LIMITE_PADRAO;
    return ok({ total: achados.length, mostrando: Math.min(limite, achados.length), projetos: achados.slice(0, limite) });
  },
});

const TIMELINE_PADRAO = 20;

const lerProjeto = ferramenta({
  nome: "ler_projeto",
  titulo: "Ler projeto",
  descricao:
    "Lê um projeto: dados do card, quadro e fase, responsável, Empresa e Contato, próxima ação, prazos e a Timeline recente (mais nova primeiro; cada entrada com autor e se foi via MCP).",
  escrita: false,
  entrada: { id, timeline: z.number().int().min(0).max(200).optional().describe(`quantas entradas da Timeline (padrão ${TIMELINE_PADRAO})`) },
  executar: async (a, eu) => {
    const c = await obterCard(a.id);
    if (!c) return erro(MENSAGEM_ERRO_PROJETO.CARD_NAO_ENCONTRADO);
    const fases = await mapaDeFases();
    const nomeFase = (v: unknown) => (typeof v === "string" ? (fases.get(v)?.nome ?? "fase removida") : undefined);
    const n = a.timeline ?? TIMELINE_PADRAO;
    // GAB-98: quem não vê a proposta também não vê os eventos dela nem o link.
    const veProposta = await podeVerPropostaDoProjeto(eu, c.id);
    const timeline = veProposta ? c.timeline : timelineSemProposta(c.timeline);
    // `slice(-0)` seria a lista inteira: 0 pede nenhuma entrada.
    const recentes = n === 0 ? [] : timeline.slice(-n).reverse();
    return ok({
      id: c.id,
      titulo: c.titulo,
      quadro: c.pipeline.chave,
      fase: { id: c.fase.id, nome: c.fase.nome, marco: c.fase.marco ? ROTULO_MARCO[c.fase.marco] : null, desde: c.faseDesde.toISOString() },
      responsavel: { id: c.responsavel.id, nome: c.responsavel.nome },
      empresa: c.empresa,
      contato: c.contato,
      proximaAcao: { texto: c.proximaAcao, data: dia(c.proximaAcaoEm) },
      campos: {
        origem: c.origem,
        dor: c.dor,
        descricao: c.descricao,
        orcamentoPrevisto: c.orcamentoPrevisto?.toFixed(2) ?? null,
        propostaUrl: veProposta ? c.propostaUrl : null,
        cidade: c.cidade,
        estado: c.estado,
        revisar: c.revisar,
        valorFechado: c.valorFechado?.toFixed(2) ?? null,
        motivoPerda: veProposta ? c.motivoPerda : mascararMotivoInviavel(c.motivoPerda),
      },
      prazos: (await listarPrazosDoCard(c.id, eu, diaEmFuso(new Date()))).map((p) => ({
        id: p.id,
        titulo: p.titulo,
        dia: p.dia,
        estado: p.estado,
        responsavel: { id: p.responsavel.id, nome: p.responsavel.nome },
        voceMexe: p.podeMexer,
      })),
      criadoEm: c.criadoEm.toISOString(),
      url: urlProjeto(c.id),
      timeline: recentes.map((t) => {
        const p = (t.payload && typeof t.payload === "object" && !Array.isArray(t.payload) ? t.payload : {}) as Record<string, unknown>;
        return {
          em: t.em.toISOString(),
          tipo: t.tipo,
          autor: t.usuario?.nome ?? "Sistema",
          viaMcp: t.viaMcp,
          // GAB-85: nota do vendedor (1–5) e sentimento do lead lido pela LLM, quando houver.
          ...(t.nota !== null ? { nota: t.nota } : {}),
          ...(t.sentimento !== null ? { sentimento: t.sentimento } : {}),
          ...(t.tipo === "MOVIMENTACAO" ? { de: nomeFase(p.deFaseId), para: nomeFase(p.paraFaseId) } : {}),
          dados: p,
        };
      }),
    });
  },
});

// ---------------------------------------------------------------- escrita

const criarProjeto = ferramenta({
  nome: "criar_projeto",
  titulo: "Criar projeto",
  descricao:
    "Cria um projeto (card) com você como responsável, como o + do Kanban. Sem fase_id, entra na primeira fase aberta do quadro. Não cria direto em fase de ganho/perdido (crie e depois mova).",
  escrita: true,
  guarda: async (a, eu) => {
    const recusa = await recusaDeCriarNoQuadro({ chave: a.quadro ?? quadroPadrao(eu) }, eu);
    return recusa && `${recusa} Informe um quadro da sua área no parâmetro \`quadro\`.`;
  },
  entrada: {
    titulo: z.string().min(1).max(1000),
    quadro: quadro.optional().describe("padrão: o quadro da sua área; sem área, vendas"),
    fase_id: id.optional(),
    descricao: z.string().max(10_000).optional(),
  },
  executar: async (a, eu) => {
    const chave = a.quadro ?? quadroPadrao(eu);
    const p = (await listarPipelines()).find((x) => x.chave === chave);
    if (!p) return erro(MENSAGEM_ERRO_PROJETO.PIPELINE_NAO_ENCONTRADO);
    const faseId = a.fase_id ?? p.fases.find((f) => !f.isTerminal)?.id;
    if (!faseId) return erro(MENSAGEM_ERRO_PROJETO.FASE_NAO_ENCONTRADA);
    const d = descricaoSchema.safeParse(a.descricao);
    if (!d.success) return erro(d.error.issues[0].message);
    const r = await criarCard({ pipelineId: p.id, faseId, titulo: a.titulo, descricao: d.data }, eu);
    if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
    return ok({ id: r.id, url: urlProjeto(r.id) });
  },
});

/** Campos que a tela edita inline, cada um como texto (o mesmo formato do formulário). */
const camposEntrada = Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c, z.string().max(10_000).optional()])) as Record<CampoEditavel, z.ZodOptional<z.ZodString>>;

/** Interpreta cada campo como a tela (`interpretarCampo`) e aplica num `editarCard` só. */
async function aplicarCampos(projetoId: string, brutos: Partial<Record<CampoEditavel, string>>, eu: UsuarioMcp): Promise<Resposta> {
  const patch: PatchCard = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    const bruto = brutos[campo];
    if (bruto === undefined) continue;
    const v = interpretarCampo(campo, bruto);
    if (!v.ok) return erro(v.erro);
    patch[campo] = v.valor;
  }
  if (Object.keys(patch).length === 0) return erro("Informe ao menos um campo para alterar.");
  const r = await editarCard(projetoId, patch, eu);
  if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
  return ok({ alterados: r.alterados, url: urlProjeto(projetoId) });
}

const atualizarProjeto = ferramenta({
  nome: "atualizar_projeto",
  titulo: "Atualizar campos do projeto",
  descricao:
    "Altera campos do projeto, no mesmo formato da tela: texto vazio limpa o campo. origem: COLD_CALL|RD|INDICACAO|EVENTO|OUTRO; orcamentoPrevisto em reais no formato BR (12.500,00); estado: sigla da UF; proximaAcaoEm: AAAA-MM-DD; responsavelId: id de listar_responsaveis; revisar: true|false. Cada mudança vai para a Timeline.",
  escrita: true,
  guarda: camposEditaveis,
  entrada: { id, campos: z.object(camposEntrada).strict() },
  executar: async (a, eu) => aplicarCampos(a.id, a.campos, eu),
});

const definirProximaAcao = ferramenta({
  nome: "definir_proxima_acao",
  titulo: "Definir próxima ação",
  descricao: "Define (ou limpa, com os dois vazios) a próxima ação do projeto e a data dela (AAAA-MM-DD).",
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, acao: z.string().max(1000), data: z.string().max(20) },
  executar: async (a, eu) => aplicarCampos(a.id, { proximaAcao: a.acao, proximaAcaoEm: a.data }, eu),
});

const moverProjeto = ferramenta({
  nome: "mover_projeto",
  titulo: "Mover projeto de fase",
  descricao:
    "Move o projeto para outra fase do MESMO quadro (as regras de marco valem como na tela: Montando contrato e o que vem depois só com a proposta aceita — registre o aceite com registrar_resposta_proposta, que já move o card; Ganho só a partir de Montando contrato — prefira marcar_contrato_assinado; Execução e o que vem depois só com o handoff completo — veja ler_handoff). Ganho em vendas pede valor_fechado (12.500,00) e leva o card ao Handoff do quadro projetos; Perdido pede motivo_perda (chave de listar_fases) e, em \"outro\", detalhe_perda.",
  escrita: true,
  guarda: cardEditavel,
  entrada: {
    id,
    fase_id: id,
    valor_fechado: z.string().max(50).optional(),
    motivo_perda: z.string().max(50).optional(),
    detalhe_perda: z.string().max(2000).optional(),
  },
  executar: async (a, eu) => {
    const dados = { valorFechado: a.valor_fechado, motivo: a.motivo_perda, detalhe: a.detalhe_perda };
    // Como a tela: sem diálogo de ganho/perda, `dadosTerminal` não vai.
    const temDados = Object.values(dados).some((v) => v !== undefined);
    const r = await moverCard(a.id, a.fase_id, eu, temDados ? { dadosTerminal: dados } : {});
    if (!r.ok) return erro(textoDoErroProjeto(r));
    return ok({ mudou: r.mudou, terminal: r.terminal, url: urlProjeto(a.id) });
  },
});

const registrarNota = ferramenta({
  nome: "registrar_nota",
  titulo: "Registrar nota",
  descricao:
    "Registra uma nota na Timeline do projeto (até 5000 caracteres). `nota` opcional: como foi o contato com o lead, de 1 (ruim) a 5 (ótimo) — só se a pessoa disser.",
  escrita: true,
  entrada: {
    id,
    texto: z.string().max(10_000),
    // GAB-85: avaliação do contato; o serviço valida de novo (mesma regra da tela).
    nota: z.number().int().min(1).max(5).nullish().describe("avaliação do contato, 1 a 5 (opcional)"),
  },
  executar: async (a, eu) => {
    const r = await adicionarNota(a.id, a.texto, eu, { nota: a.nota ?? null });
    if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
    return ok({ registrada: true, url: urlProjeto(a.id) });
  },
});

const buscarEmpresasContatos = ferramenta({
  nome: "buscar_empresas_contatos",
  titulo: "Buscar empresas e contatos",
  descricao: "Busca Empresas e/ou Contatos vivos pelo nome (prefixo primeiro), para achar o id antes de vincular a um projeto.",
  escrita: false,
  entrada: { texto: z.string().min(1).max(100), tipo: z.enum(["empresa", "contato"]).optional().describe("sem ele, os dois") },
  executar: async (a) =>
    ok({
      empresas: a.tipo === "contato" ? [] : await buscarEmpresasPorNome(a.texto, 10),
      contatos: a.tipo === "empresa" ? [] : await buscarContatosPorNome(a.texto, 10),
    }),
});

const vincularEmpresaContato = ferramenta({
  nome: "vincular_empresa_contato",
  titulo: "Vincular empresa ou contato ao projeto",
  descricao: "Vincula ao projeto uma Empresa ou um Contato existente (id de buscar_empresas_contatos). alvo_id vazio desvincula. A troca vai para a Timeline.",
  escrita: true,
  guarda: cardEditavel,
  entrada: { id, campo: z.enum(["empresa", "contato"]), alvo_id: z.string().max(64).describe('id da empresa/contato; "" desvincula') },
  executar: async (a, eu) => {
    const r = await vincularAoCard(a.id, a.campo, a.alvo_id.trim() || null, eu);
    if (!r.ok) return erro(MENSAGEM_VINCULO[r.erro]);
    return ok({ mudou: r.mudou, url: urlProjeto(a.id) });
  },
});

const criarPrazoMcp = ferramenta({
  nome: "criar_prazo",
  titulo: "Criar prazo",
  descricao:
    "Cria um prazo (linha de chegada no Calendário), de um projeto ou solto. responsavel_id padrão: você. Como na tela: vendedor/projetos só cria prazo de si mesmo; gestão, de qualquer um.",
  escrita: true,
  entrada: {
    titulo: z.string().max(1000),
    dia: z.string().max(20).describe("AAAA-MM-DD"),
    projeto_id: id.optional(),
    responsavel_id: id.optional().describe('id da pessoa ou "eu"'),
  },
  executar: async (a, eu) => {
    const responsavelId = !a.responsavel_id || a.responsavel_id === "eu" ? eu.id : a.responsavel_id;
    const r = await criarPrazo(eu, { titulo: a.titulo, dia: a.dia, responsavelId, projetoId: a.projeto_id ?? null });
    if (!r.ok) return erro(mensagemFalhaPrazo(r));
    return ok({ id: r.id });
  },
});

const concluirPrazo = ferramenta({
  nome: "concluir_prazo",
  titulo: "Concluir prazo",
  descricao: "Marca um prazo como feito (ou reabre, com feito=false). O id vem de ler_projeto.",
  escrita: true,
  entrada: { prazo_id: id, feito: z.boolean().optional().describe("padrão true") },
  executar: async (a, eu) => {
    const r = await marcarPrazoFeito(eu, a.prazo_id, a.feito ?? true);
    if (!r.ok) return erro(mensagemFalhaPrazo(r));
    return ok({ feito: a.feito ?? true });
  },
});

// ---------------------------------------------------------------- anexos (GAB-84)

/** Pedaço padrão do texto de um anexo: cabe no contexto; o resto vem com `inicio`. */
const TRECHO_PADRAO = 50_000;
const SEM_ANEXO = "Anexo não encontrado (pode ter sido excluído, ou o projeto está na lixeira).";

const listarAnexosMcp = ferramenta({
  nome: "listar_anexos",
  titulo: "Listar anexos do projeto",
  descricao:
    "Lista os arquivos anexados a um projeto (PDF, Word, Markdown, texto, imagens): nome, tipo, tamanho, autor, data e se há texto extraído (semTexto = escaneado/imagem, aguardando OCR). O texto se lê com ler_anexo.",
  escrita: false,
  entrada: { projeto_id: id },
  executar: async (a) => {
    if (!(await obterCard(a.projeto_id))) return erro(MENSAGEM_ERRO_PROJETO.CARD_NAO_ENCONTRADO);
    const anexos = await listarAnexos(a.projeto_id);
    return ok({
      anexos: anexos.map((x) => ({
        id: x.id,
        nome: x.nome,
        tipo: ROTULO_TIPO_ANEXO[x.tipo],
        tamanhoBytes: x.tamanho,
        semTexto: x.semTexto,
        contratoAssinado: x.contratoAssinado,
        caracteres: x.caracteres,
        autor: { id: x.autor.id, nome: x.autor.nome },
        criadoEm: x.criadoEm.toISOString(),
      })),
      url: urlProjeto(a.projeto_id),
    });
  },
});

const lerAnexo = ferramenta({
  nome: "ler_anexo",
  titulo: "Ler texto de um anexo",
  descricao: `Lê o texto extraído de um anexo (id de listar_anexos), em trechos de até ${TRECHO_PADRAO} caracteres: use "inicio" para continuar. Escaneado/imagem não tem texto ainda (OCR pendente).`,
  escrita: false,
  entrada: {
    anexo_id: id,
    inicio: z.number().int().min(0).optional().describe("caractere inicial (padrão 0)"),
    limite: z.number().int().min(1).max(200_000).optional().describe(`quantos caracteres (padrão ${TRECHO_PADRAO})`),
  },
  executar: async (a) => {
    const x = await lerTextoDoAnexo(a.anexo_id);
    if (!x) return erro(SEM_ANEXO);
    if (x.texto === null) {
      return ok({ id: x.id, nome: x.nome, semTexto: true, texto: null, aviso: "Anexo sem texto (escaneado ou imagem): o OCR ainda não existe." });
    }
    const inicio = a.inicio ?? 0;
    const trecho = x.texto.slice(inicio, inicio + (a.limite ?? TRECHO_PADRAO));
    const fim = inicio + trecho.length;
    return ok({ id: x.id, nome: x.nome, projetoId: x.projetoId, semTexto: false, caracteres: x.texto.length, inicio, fim, continua: fim < x.texto.length, texto: trecho });
  },
});

// ---------------------------------------------------------------- painel (GAB-94)

const consultarPainelVendas = ferramenta({
  nome: "consultar_painel_vendas",
  titulo: "Consultar o painel de vendas",
  descricao:
    "Indicadores do painel de vendas (os MESMOS números da tela /painel): conversao (estamos convertendo? ganhos, perdidos, conversão, R$ fechado, conversão e tempo médio por fase), engajamento (interações por vendedor via WhatsApp #crm, tela e MCP; próximas ações feitas no prazo), acompanhamento (situação de agora: cards abertos sem próxima ação, com próxima ação vencida, dias desde o último contato, os mais parados) e satisfacao (nota média 1–5 e sentimento). Período: semana (seg–dom) ou mês civil de São Paulo, o que contém `ref` (padrão: hoje). Filtro opcional por vendedor (id ou \"eu\"); com o ranking oculto pelo gestor, quem não é gestor só vê as próprias linhas e os totais do time. Valor em proposta e versões até fechar ainda não têm dados (dependem da Proposta). A resposta traz `definicoes` com a fórmula de cada indicador.",
  escrita: false,
  entrada: {
    indicador: z.enum([...INDICADORES, "todos"]).optional().describe("padrão: todos"),
    periodo: z.enum(["semana", "mes"]).optional().describe("padrão: mes"),
    ref: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD")
      .optional()
      .describe("um dia (AAAA-MM-DD) do período; padrão: hoje"),
    vendedor_id: id.optional().describe('id da pessoa, ou "eu"'),
  },
  executar: async (a, eu) => {
    const agora = new Date();
    const periodo = resolverPeriodo(a.periodo ?? "mes", a.ref, agora);
    const vendedorId = a.vendedor_id === "eu" ? eu.id : (a.vendedor_id ?? null);
    const indicadores = !a.indicador || a.indicador === "todos" ? INDICADORES : [a.indicador];
    const v = await carregarPainelPara(eu, { periodo, vendedorId }, agora, indicadores);
    if (!v.ok)
      return erro(
        v.erro === "VENDEDOR_DESCONHECIDO"
          ? "Vendedor não encontrado. Use listar_responsaveis para ver os ids."
          : 'O gestor ocultou o ranking: você só pode consultar os seus números (vendedor_id "eu") ou os totais do time (sem vendedor_id).',
      );
    const painel = v.painel;
    return ok({
      visao: v.modo === "completo" ? "completa" : "só as suas linhas e os totais do time (ranking oculto pelo gestor)",
      periodo: { tipo: periodo.tipo, rotulo: periodo.rotulo, primeiroDia: periodo.primeiroDia, ultimoDia: periodo.ultimoDia, atual: periodo.atual },
      vendedor: painel.vendedor ? { id: painel.vendedor.id, nome: painel.vendedor.nome } : null,
      ...Object.fromEntries(indicadores.map((i) => [i, painel[i]])),
      definicoes: { ...Object.fromEntries(indicadores.map((i) => [i, DEFINICOES_PAINEL[i]])), visibilidade: VISIBILIDADE_PAINEL },
      tela: `${urlBase()}/painel?periodo=${periodo.tipo}&ref=${periodo.primeiroDia}${vendedorId ? `&vendedor=${vendedorId}` : ""}`,
    });
  },
});

// ---------------------------------------------------------------- proposta (GAB-86)

const urlProposta = (pid: string) => `${urlBase()}/projetos/${pid}/proposta`;

/** Parte estruturada no MESMO formato que `editar_proposta` aceita (dinheiro BR, dia AAAA-MM-DD). */
function estruturadoMcp(e: Estruturado) {
  const x = estruturadoParaEntrada(e);
  return { valor: x.valor || null, prazo_dias: e.prazoDias, escopo_resumo: e.escopoResumo, entregas: x.entregas.map(({ duracao, dia, ...en }) => ({ ...en, dia: dia || null, ...(duracao ? { duracao } : {}), valor: en.valor || null })) };
}

/** O que cada ação faz, para o Claude escolher a ferramenta certa. */
const FERRAMENTA_DA_ACAO: Record<AcaoCaneta, string> = {
  passar: "passar_caneta_proposta",
  devolver: "devolver_proposta",
  concordar: "concordar_proposta",
  pegar: "pegar_caneta_proposta",
  reabrir: "reabrir_proposta",
  inviavel: "marcar_proposta_inviavel",
};

/** GAB-89: envio e resposta do cliente. */
const FERRAMENTA_DO_ENVIO: Record<AcaoEnvio, string> = {
  enviar: "marcar_proposta_enviada",
  responder: "registrar_resposta_proposta",
  concluirRevisao: "concluir_revisao_proposta",
};

const erroProposta = (r: Falha) => erro(r.erro === "CONFLITO" ? `${mensagemDaFalha(r)} Use ler_proposta.` : mensagemDaFalha(r));

const projetoId = id.describe("id do projeto (de buscar_projetos)");

const lerProposta = ferramenta({
  nome: "ler_proposta",
  titulo: "Ler proposta do projeto",
  descricao:
    "Lê a proposta do projeto (uma por projeto): status, o texto do rascunho em Markdown (linhas `<!-- bloco:cronograma -->` e `<!-- bloco:investimento -->` marcam onde esses blocos ficam; sem elas, os dois ficam no fim; mantenha-as ao reescrever), a parte estruturada (valor, prazo em dias, escopo resumido, cronograma de entregas com dia ou duracao), a lista de versões salvas e a `revisao` atual — guarde-a: editar_proposta e salvar_versao_proposta pedem a revisão que você leu (se alguém mexeu depois, você recebe conflito em vez de sobrescrever). Diz também se você pode editar.",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId },
  executar: async (a, eu) => {
    const r = await obterPropostaDoProjeto(a.projeto_id);
    if (!r) return erro(MENSAGEM_ERRO_PROPOSTA.PROJETO_NAO_ENCONTRADO);
    const pessoa = await pessoaDaCaneta(eu.id);
    if (!r.proposta) {
      const cria = !!pessoa && pessoa.ativo && podeCriarProposta(pessoa, r.projeto);
      return ok({ existe: false, projeto: r.projeto.titulo, voceCria: cria, dica: cria ? "Crie com criar_proposta." : "Quem é de vendas e responsável pelo projeto (ou a gestão) cria.", url: urlProposta(a.projeto_id) });
    }
    const p = r.proposta;
    // GAB-93: no quadro Projetos a proposta está congelada (os serviços recusam).
    const congelada = r.projeto.pipeline.chave === PIPELINE_PROJETOS;
    const edita = !congelada && !!pessoa && podeEditarProposta(pessoa, p.estado);
    const acoes = !congelada && pessoa ? acoesPossiveis(pessoa, p.estado) : [];
    const envio = !congelada && pessoa ? acoesDeEnvio(pessoa, p.estado) : [];
    const pessoas = acoes.some((x) => x === "passar" || x === "devolver") ? await listarPessoasDaCaneta() : [];
    const final = await versaoFinalDaProposta(a.projeto_id);
    return ok({
      existe: true,
      projeto: r.projeto.titulo,
      status: ROTULO_STATUS_PROPOSTA[p.status],
      revisao: p.revisao,
      caneta: {
        com: p.canetaCom?.nome ?? null,
        comId: p.canetaComId,
        lado: ROTULO_AREA[ladoDaCaneta(p)],
        desde: p.canetaDesde?.toISOString() ?? null,
        regra: "Só quem está com a caneta edita (você, pelo Claude, age como você). Os outros leem e comentam.",
      },
      ...(p.motivoInviavel ? { motivoInviavel: p.motivoInviavel } : {}),
      ...(p.versaoEnviada ? { envio: { versaoEnviada: p.versaoEnviada, enviadaEm: p.enviadaEm?.toISOString() ?? null, respondidaEm: p.respondidaEm?.toISOString() ?? null } } : {}),
      ...(p.motivoRecusa ? { motivoRecusa: p.motivoRecusa } : {}),
      ...(final.ok ? { pdf: { versao: final.numero, dica: "Gere o link com gerar_pdf_proposta." } } : {}),
      voceEdita: edita,
      voceEstaComACaneta: p.canetaComId === eu.id,
      acoesQueVocePode: [...acoes.map((x) => FERRAMENTA_DA_ACAO[x]), ...envio.map((x) => FERRAMENTA_DO_ENVIO[x])],
      ...(pessoas.length
        ? { pessoasParaCaneta: pessoas.map((x) => ({ id: x.id, nome: x.nome, lado: ROTULO_AREA[x.lado], ...(x.gp ? { gp: true } : {}) })) }
        : {}),
      markdown: p.conteudoMd,
      estruturado: estruturadoMcp(p.estruturado),
      rascunho: { por: p.rascunhoPor?.nome ?? null, em: p.rascunhoEm?.toISOString() ?? null, viaMcp: p.rascunhoViaMcp },
      versoes: p.versoes.map((v) => ({ numero: v.numero, nota: v.nota, autor: v.autor.nome, lado: v.autorLado ? ROTULO_AREA[v.autorLado] : null, em: v.criadoEm.toISOString(), viaMcp: v.viaMcp })),
      formatacao: "Markdown aceito: # / ## / ### títulos, **negrito**, *itálico*, listas (- e 1.), --- linha. O resto (link, imagem, HTML, tabela, código) entra como texto.",
      url: urlProposta(a.projeto_id),
    });
  },
});

const criarPropostaMcp = ferramenta({
  nome: "criar_proposta",
  titulo: "Criar proposta do projeto",
  descricao: "Cria a proposta do projeto (no máximo uma por projeto), em Rascunho, com um esqueleto de títulos. Vai para a Timeline. Depois use editar_proposta.",
  escrita: true,
  entrada: { projeto_id: projetoId },
  executar: async (a, eu) => {
    const r = await criarProposta(a.projeto_id, eu);
    if (!r.ok) return erro(mensagemDaFalha(r));
    return ok({ criada: true, revisao: r.revisao, url: urlProposta(a.projeto_id) });
  },
});

const entregaMcp = z
  .object({
    titulo: z.string().max(400),
    dia: z.string().max(20).nullable().optional().describe("AAAA-MM-DD; a entrega tem data OU duração"),
    duracao: z.string().max(DURACAO_MAX_CAMPO).nullable().optional().describe('dias, semanas ou meses, como "2 semanas"'),
    valor: z.string().max(50).nullable().optional().describe("parcela em reais, 12.500,00"),
  })
  .strict();

const editarPropostaMcp = ferramenta({
  nome: "editar_proposta",
  titulo: "Editar rascunho da proposta",
  descricao:
    "Altera o RASCUNHO da proposta (não cria versão). Mande `revisao` (de ler_proposta) e o que mudar: `markdown` substitui o texto inteiro; valor (reais, 12.500,00), prazo_dias (inteiro), escopo_resumo e entregas (lista completa do cronograma, na ordem: titulo, dia AAAA-MM-DD ou duracao como \"2 semanas\", valor opcional) substituem só esses campos. Texto vazio limpa o campo. Blocos móveis no markdown: uma linha sozinha `<!-- bloco:cronograma -->` ou `<!-- bloco:investimento -->` põe na folha, nesse lugar, o bloco com esses dados (um de cada; os dados não vão no texto). Sem nenhuma dessas linhas os dois ficam no fim. Com só uma, a outra sai da folha e do PDF. Para tirar os dois, use `<!-- bloco:nenhum -->`. Se alguém alterou depois da sua leitura, volta conflito e nada é gravado: leia de novo e reaplique.",
  escrita: true,
  guarda: propostaVisivel,
  entrada: {
    projeto_id: projetoId,
    revisao: z.number().int().min(0),
    markdown: z.string().max(MARKDOWN_MAX).optional().describe(`até ${MARKDOWN_MAX} caracteres`),
    valor: z.string().max(50).optional(),
    prazo_dias: z.string().max(10).optional().describe("dias corridos; vazio limpa"),
    escopo_resumo: z.string().max(4000).optional(),
    entregas: z.array(entregaMcp).max(100).optional(),
  },
  executar: async (a, eu) => {
    const mexeEstruturado = a.valor !== undefined || a.prazo_dias !== undefined || a.escopo_resumo !== undefined || a.entregas !== undefined;
    if (a.markdown === undefined && !mexeEstruturado) return erro("Informe o markdown e/ou algum campo da parte estruturada.");
    let estruturado: EstruturadoEntrada | undefined;
    if (mexeEstruturado) {
      // Campos não mandados ficam como estão: parte do rascunho atual (a revisão protege contra leitura velha).
      const atual = await obterPropostaDoProjeto(a.projeto_id);
      const base = atual?.proposta ? estruturadoParaEntrada(atual.proposta.estruturado) : estruturadoParaEntrada({ valor: null, prazoDias: null, escopoResumo: null, entregas: [] });
      estruturado = {
        valor: a.valor ?? base.valor,
        prazoDias: a.prazo_dias ?? base.prazoDias,
        escopoResumo: a.escopo_resumo ?? base.escopoResumo,
        // Volta na mesma forma de ler_proposta (null = campo vazio).
        entregas: a.entregas?.map((en) => ({ titulo: en.titulo, dia: en.dia ?? "", duracao: en.duracao ?? "", valor: en.valor ?? "" })) ?? base.entregas,
      };
    }
    const r = await salvarRascunho(a.projeto_id, { revisao: a.revisao, ...(a.markdown !== undefined ? { conteudo: { markdown: a.markdown } } : {}), ...(estruturado ? { estruturado } : {}) }, eu);
    if (!r.ok) return erroProposta(r);
    return ok({ mudou: r.mudou, revisao: r.revisao, markdownGravado: r.markdown, estruturado: estruturadoMcp(r.estruturado), url: urlProposta(a.projeto_id) });
  },
});

const salvarVersaoMcp = ferramenta({
  nome: "salvar_versao_proposta",
  titulo: "Salvar versão da proposta",
  descricao: `Salva o rascunho atual como nova versão imutável (v1, v2…), com nota opcional (até ${NOTA_VERSAO_MAX} caracteres). Peça a \`revisao\` que você leu: a versão é do conteúdo que você viu. Vai para a Timeline.`,
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, revisao: z.number().int().min(0), nota: z.string().max(2000).optional() },
  executar: async (a, eu) => {
    const r = await salvarVersao(a.projeto_id, { revisao: a.revisao, nota: a.nota }, eu);
    if (!r.ok) return erroProposta(r);
    return ok({ versao: r.numero, url: `${urlProposta(a.projeto_id)}/versoes/${r.numero}` });
  },
});

const listarVersoesMcp = ferramenta({
  nome: "listar_versoes_proposta",
  titulo: "Listar versões da proposta",
  descricao: "Lista as versões salvas da proposta (mais nova primeiro): número, nota, autor, data e se foi via MCP.",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId },
  executar: async (a) => {
    const r = await obterPropostaDoProjeto(a.projeto_id);
    if (!r) return erro(MENSAGEM_ERRO_PROPOSTA.PROJETO_NAO_ENCONTRADO);
    if (!r.proposta) return erro(MENSAGEM_ERRO_PROPOSTA.PROPOSTA_NAO_ENCONTRADA);
    return ok({ versoes: r.proposta.versoes.map((v) => ({ numero: v.numero, nota: v.nota, autor: v.autor.nome, em: v.criadoEm.toISOString(), viaMcp: v.viaMcp })) });
  },
});

const lerVersaoMcp = ferramenta({
  nome: "ler_versao_proposta",
  titulo: "Ler versão da proposta",
  descricao: "Lê uma versão salva da proposta (imutável): o Markdown e a parte estruturada daquele momento, com nota, autor e data.",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, numero: z.number().int().min(1) },
  executar: async (a) => {
    const v = await obterVersao(a.projeto_id, a.numero);
    if (!v) return erro(MENSAGEM_ERRO_PROPOSTA.VERSAO_NAO_ENCONTRADA);
    return ok({
      numero: v.numero,
      nota: v.nota,
      autor: v.autor.nome,
      em: v.criadoEm.toISOString(),
      viaMcp: v.viaMcp,
      markdown: v.conteudoMd,
      estruturado: estruturadoMcp(v.estruturado),
      url: `${urlProposta(a.projeto_id)}/versoes/${v.numero}`,
    });
  },
});

// ---------------------------------------------------------------- caneta (GAB-87)

const paraId = id.describe("id da pessoa (de pessoasParaCaneta em ler_proposta)");

/** Resultado comum das ações da caneta. */
function okCaneta(pid: string, r: { status: Parameters<typeof rotuloStatus>[0]; canetaComNome: string | null; numero?: number }) {
  return ok({ status: rotuloStatus(r.status), canetaCom: r.canetaComNome, ...(r.numero ? { versao: r.numero } : {}), url: urlProposta(pid) });
}
const rotuloStatus = (s: keyof typeof ROTULO_STATUS_PROPOSTA) => ROTULO_STATUS_PROPOSTA[s];

const passarCanetaMcp = ferramenta({
  nome: "passar_caneta_proposta",
  titulo: "Passar a caneta da proposta",
  descricao: "Passa a caneta (quem edita a proposta) para outra pessoa do MESMO lado (vendas→vendas, projetos→projetos). Só quem está com a caneta passa. Não salva versão. Para mandar ao outro lado use devolver_proposta.",
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, para_id: paraId },
  executar: async (a, eu) => {
    const r = await passarCaneta(a.projeto_id, a.para_id, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const devolverMcp = ferramenta({
  nome: "devolver_proposta",
  titulo: "Devolver a proposta ao outro lado",
  descricao: `Devolve a proposta para alguém do OUTRO lado avaliar (vendas ↔ projetos): salva o rascunho atual como versão (nota opcional, até ${NOTA_VERSAO_MAX} caracteres) e passa a caneta. Mande a \`revisao\` de ler_proposta (conflito = alguém mexeu depois). Se nada mudou desde a versão que veio do outro lado, use concordar_proposta.`,
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, revisao: z.number().int().min(0), para_id: paraId, nota: z.string().max(2000).optional() },
  executar: async (a, eu) => {
    const r = await devolverProposta(a.projeto_id, { revisao: a.revisao, paraId: a.para_id, nota: a.nota }, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const concordarMcp = ferramenta({
  nome: "concordar_proposta",
  titulo: "Concordar com a proposta",
  descricao:
    "Concorda com a última versão, que veio do OUTRO lado, sem editar: há consenso e a proposta fica Pronta para envio (a caneta fica com vendas, que envia). Só vale se a última versão é do outro lado e o rascunho não foi mexido depois dela. Mande a `revisao` de ler_proposta.",
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, revisao: z.number().int().min(0) },
  executar: async (a, eu) => {
    const r = await concordarProposta(a.projeto_id, a.revisao, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const pegarCanetaMcp = ferramenta({
  nome: "pegar_caneta_proposta",
  titulo: "Pegar a caneta da proposta (GP)",
  descricao: "Só para o GP do lado que está com a caneta: pega a caneta para destravar (quem estava com ela sumiu, ou ninguém está). Fica na Timeline.",
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId },
  executar: async (a, eu) => {
    const r = await pegarCaneta(a.projeto_id, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const reabrirMcp = ferramenta({
  nome: "reabrir_proposta",
  titulo: "Reabrir proposta pronta para envio",
  descricao: "Proposta Pronta para envio → Em ajuste (vendas quer mudar algo antes de enviar). Só quem está com a caneta. Depois de mudar, ela precisa passar por projetos de novo (devolver_proposta).",
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId },
  executar: async (a, eu) => {
    const r = await reabrirProposta(a.projeto_id, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const inviavelMcp = ferramenta({
  nome: "marcar_proposta_inviavel",
  titulo: "Marcar proposta como inviável",
  descricao: `Projetos diz que a proposta é inviável, com motivo (até ${MOTIVO_INVIAVEL_MAX} caracteres): a proposta sai do pingue-pongue e o projeto vai para Perdido no quadro de Vendas. Só o PM de projetos ou quem está com a caneta do lado de projetos. Não tem volta pelo MCP: confirme com a pessoa antes.`,
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, motivo: z.string().max(2000) },
  executar: async (a, eu) => {
    const r = await marcarInviavel(a.projeto_id, a.motivo, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

// ---------------------------------------------------------------- envio e resposta do cliente (GAB-89)

const gerarPdfMcp = ferramenta({
  nome: "gerar_pdf_proposta",
  titulo: "Gerar o PDF da proposta (link de download)",
  descricao:
    "Link de download do PDF da proposta: a versão final (texto + valor, prazo, escopo e cronograma) no template da IJ. Existe a partir de Pronta para envio (depois do envio, é a versão enviada). O link abre no navegador com o login do CRM. O sistema não envia nada ao cliente: a pessoa baixa e manda pelo canal que quiser, depois marca com marcar_proposta_enviada.",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId },
  executar: async (a) => {
    const r = await versaoFinalDaProposta(a.projeto_id);
    if (!r.ok) return erroProposta(r);
    return ok({ versao: r.numero, arquivo: r.nomeArquivo, download: urlPdfDaProposta(urlBase(), a.projeto_id, r.numero), url: urlProposta(a.projeto_id) });
  },
});

const marcarEnviadaMcp = ferramenta({
  nome: "marcar_proposta_enviada",
  titulo: "Marcar proposta como enviada ao cliente",
  descricao:
    "Vendas marca que mandou a proposta (Pronta para envio) ao cliente — o sistema não envia e-mail. Só quem está com a caneta (vendas) ou o GP de vendas. Mande `versao` (de gerar_pdf_proposta) para garantir que é a do PDF que foi mandado.",
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, versao: z.number().int().min(1).optional() },
  executar: async (a, eu) => {
    const r = await marcarEnviada(a.projeto_id, eu, { versao: a.versao });
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const registrarRespostaMcp = ferramenta({
  nome: "registrar_resposta_proposta",
  titulo: "Registrar a resposta do cliente à proposta",
  descricao: `Resposta do cliente a uma proposta Enviada (vendas: quem está com a caneta ou o GP de vendas). "aceita" → o projeto vai para Montando contrato. "recusada" → motivo_perda obrigatório (chave de listar_fases; "outro" exige detalhe_perda) e o projeto vai para Perdido. "revisao_pedida" → a caneta volta para você, com o pedido (opcional, até ${PEDIDO_REVISAO_MAX} caracteres); edite e use concluir_revisao_proposta (se escopo/prazo/valor não mudaram) ou devolver_proposta para projetos. Confirme com a pessoa antes: aceite e recusa movem o card.`,
  escrita: true,
  guarda: propostaVisivel,
  entrada: {
    projeto_id: projetoId,
    resposta: z.enum(["aceita", "recusada", "revisao_pedida"]),
    motivo_perda: z.string().max(50).optional(),
    detalhe_perda: z.string().max(1000).optional(),
    pedido: z.string().max(4000).optional(),
  },
  executar: async (a, eu) => {
    const resposta = a.resposta === "aceita" ? "ACEITA" : a.resposta === "recusada" ? "RECUSADA" : "REVISAO_PEDIDA";
    const r = await registrarResposta(a.projeto_id, { resposta, motivo: a.motivo_perda, detalhe: a.detalhe_perda, pedido: a.pedido }, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const concluirRevisaoMcp = ferramenta({
  nome: "concluir_revisao_proposta",
  titulo: "Concluir a revisão pedida pelo cliente",
  descricao: `Revisão pedida pelo cliente → Pronta para envio de novo, sem passar por projetos: só se valor, prazo, escopo e entregas são os mesmos da versão enviada (senão é recusado: use devolver_proposta). Salva o rascunho atual como versão (nota opcional, até ${NOTA_VERSAO_MAX} caracteres) se o texto mudou. Mande a \`revisao\` de ler_proposta.`,
  escrita: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, revisao: z.number().int().min(0), nota: z.string().max(2000).optional() },
  executar: async (a, eu) => {
    const r = await concluirRevisao(a.projeto_id, { revisao: a.revisao, nota: a.nota }, eu);
    return r.ok ? okCaneta(a.projeto_id, r) : erroProposta(r);
  },
});

const verDiffMcp = ferramenta({
  nome: "ver_diff_proposta",
  titulo: "Ver o que mudou entre versões da proposta",
  descricao:
    "Diff entre duas versões da proposta: texto (linhas com '- ' saiu, '+ ' entrou, '  ' igual) e campos da parte estruturada que mudaram. Sem `de`/`para`: da última versão que o SEU lado entregou até a última (o que voltou para você).",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: projetoId, de: z.number().int().min(1).optional(), para: z.number().int().min(1).optional() },
  executar: async (a, eu) => {
    const d = await diffDaProposta(a.projeto_id, { de: a.de, para: a.para, quem: eu.id });
    if (!d) return erro(a.de !== undefined || a.para !== undefined ? MENSAGEM_ERRO_PROPOSTA.VERSAO_NAO_ENCONTRADA : "A proposta ainda não tem versão salva.");
    return ok({
      de: d.de ? { versao: d.de.numero, autor: d.de.autor, lado: d.de.lado ? ROTULO_AREA[d.de.lado] : null } : null,
      para: { versao: d.para.numero, autor: d.para.autor, lado: d.para.lado ? ROTULO_AREA[d.para.lado] : null },
      texto: diffParaTexto(d.texto),
      estruturado: d.estruturado,
      url: `${urlProposta(a.projeto_id)}/diff?${d.de ? `de=${d.de.numero}&` : ""}para=${d.para.numero}`,
    });
  },
});

// ---------------------------------------------------------------- avisos (GAB-88)

const listarAvisosMcp = ferramenta({
  nome: "listar_avisos",
  titulo: "Listar meus avisos",
  descricao: `Avisos do sino do CRM para VOCÊ (é sua vez na proposta, GP pegou a caneta, mudança de status…), mais recentes primeiro. Por padrão só os não lidos; \`todos: true\` inclui os lidos. Até ${LISTA_MAX} (padrão ${LISTA_PADRAO}). Use os ids em marcar_avisos_lidos.`,
  // Lê só os avisos da própria pessoa: vale para qualquer papel, como o sino.
  escrita: false,
  entrada: { todos: z.boolean().optional(), limite: z.number().int().min(1).max(LISTA_MAX).optional() },
  executar: async (a, eu) => {
    const [naoLidos, avisos] = await Promise.all([contarNaoLidos(eu.id), listarAvisos(eu.id, { soNaoLidos: !a.todos, limite: a.limite })]);
    return ok({
      naoLidos,
      avisos: avisos.map((x) => ({
        id: x.id,
        tipo: x.tipo,
        titulo: x.titulo,
        lido: x.lido,
        em: x.criadoEm.toISOString(),
        url: x.href ? `${urlBase()}${x.href}` : null,
        ...(x.whatsappFalhouRef ? { whatsappFalhou: `ref ${x.whatsappFalhouRef}` } : {}),
      })),
    });
  },
});

const marcarAvisosLidosMcp = ferramenta({
  nome: "marcar_avisos_lidos",
  titulo: "Marcar meus avisos como lidos",
  descricao: "Marca como lidos os avisos com os `ids` de listar_avisos; sem `ids`, marca todos os seus. Só mexe nos SEUS avisos (id de outra pessoa é ignorado).",
  // Mexe só no estado do próprio sino, não no CRM: qualquer papel marca, como na tela.
  escrita: false,
  // ...mas grava `lido_em`: não anuncia readOnly.
  muda: true,
  entrada: { ids: z.array(id).max(200).optional() },
  executar: async (a, eu) => {
    const marcados = await marcarLidos(eu.id, a.ids);
    return ok({ marcados, naoLidos: await contarNaoLidos(eu.id) });
  },
});

/**
 * Maior `pdf_base64` aceito: o proxy do Next corta o corpo em 10 MiB (`proxyClientMaxBodySize`
 * padrão, src/proxy.ts cobre /api/mcp) e o JSON cortado vira "Parse error". 64 KiB ficam para o
 * envelope JSON-RPC e os outros argumentos. Dá cerca de 7,8 MB de PDF, menos que o limite da tela.
 */
export const PDF_BASE64_MAX = 10 * 1024 * 1024 - 64 * 1024;

const marcarContratoAssinadoMcp = ferramenta({
  nome: "marcar_contrato_assinado",
  titulo: "Marcar contrato como assinado",
  descricao:
    "Contrato assinado: leva o projeto em Montando contrato (ou numa subfase depois dele) para Ganho e dali ao Handoff do quadro projetos, registrando a data e o valor fechado. Fora disso é recusado, nem gestor força. valor_fechado no formato 12.500,00; ausente ou vazio mantém o valor já guardado no projeto, e sem nenhum valor o ganho sai com um aviso na resposta. pdf_base64 (opcional, PDF de até 7,8 MB; maior que isso, anexe pela tela) anexa o PDF assinado ao projeto; pdf_nome é o nome do arquivo e só vale com pdf_base64.",
  escrita: true,
  guarda: cardEditavel,
  entrada: {
    id,
    valor_fechado: z.string().max(50).optional(),
    pdf_nome: z.string().max(1000).optional(),
    pdf_base64: z.string().max(PDF_BASE64_MAX, "PDF grande demais para o conector: o limite é 7,8 MB. Anexe pela tela do CRM.").optional(),
  },
  executar: async (a, eu) => {
    if (a.pdf_nome?.trim() && a.pdf_base64 === undefined) return erro("pdf_nome veio sem pdf_base64: envie o conteúdo do PDF em pdf_base64 ou tire pdf_nome. Nada foi alterado.");
    if (a.pdf_base64 !== undefined && !BASE64.test(a.pdf_base64)) return erro("pdf_base64 não é base64 válido.");
    const arquivo = a.pdf_base64 !== undefined ? { nome: a.pdf_nome?.trim() || "Contrato assinado.pdf", bytes: new Uint8Array(Buffer.from(a.pdf_base64, "base64")) } : null;
    // Vazio aqui é "não informei", não "apague o valor" (só o campo do diálogo limpa).
    const r = await marcarContratoAssinado(a.id, { valorFechado: a.valor_fechado?.trim() || undefined, arquivo }, eu);
    if (!r.ok) return erro(MENSAGEM_ERRO_CONTRATO[r.erro]);
    const aviso = r.mudou && r.valorFechado === null ? { aviso: "Ganho registrado sem valor fechado: valor_fechado não foi informado e o projeto não tinha valor guardado. Avise a pessoa." } : {};
    return ok({ mudou: r.mudou, anexo: r.anexo, valor_fechado: r.valorFechado, ...aviso, url: urlProjeto(a.id) });
  },
});

// ---------------------------------------------------------------- handoff (GAB-93)

const lerHandoff = ferramenta({
  nome: "ler_handoff",
  titulo: "Ler o handoff do projeto",
  descricao:
    "Mostra o handoff de um projeto do quadro projetos: GP do projeto, checklist (proposta final congelada, automática; PDF do contrato assinado; contatos do cliente; kickoff; acessos e materiais), resumo escrito por vendas, o que falta para entrar em Execução e as pessoas que podem ser designadas GP. isento=true: card anterior à trava, que não precisa fechar o handoff.",
  escrita: false,
  entrada: { id },
  executar: async (a, eu) => {
    const h = await obterHandoff(a.id);
    if (!h) return erro("Esse projeto não está no quadro projetos (ou não existe): o handoff começa no Ganho.");
    return ok({
      editavel: h.emHandoff,
      isento: h.isento,
      completo: h.completo,
      falta: h.pendencias.length ? descreverPendencias(h.pendencias) : null,
      gp: h.gp ? { ...h.gp, valido: h.gpValido, responsavel: !h.responsavelDiverge } : null,
      ...(h.emHandoff && !h.gpValido && (await listarGpsDeProjetos()).length === 0 ? { aviso: "Ninguém tem o cargo de PM de projetos: peça à gestão para dar o cargo a alguém, que então designa o GP do projeto." } : {}),
      checklist: {
        proposta_congelada: { feito: h.proposta.congelada, dispensada: h.proposta.dispensada, versao: (await podeVerPropostaDoProjeto(eu, a.id)) ? h.proposta.versao : null, automatico: true },
        contrato_pdf: { feito: !!h.contrato, anexo: h.contrato },
        contatos: { feito: !!h.itens.contatos, em: h.itens.contatos?.toISOString() ?? null },
        kickoff: { feito: !!h.itens.kickoff, em: h.itens.kickoff?.toISOString() ?? null },
        acessos: { feito: !!h.itens.acessos, em: h.itens.acessos?.toISOString() ?? null },
      },
      resumo: { ...h.resumo, por: h.resumoPor, em: h.resumoEm?.toISOString() ?? null },
      candidatos_gp: h.emHandoff ? await listarCandidatosGp() : [],
      url: urlProjeto(a.id),
    });
  },
});

const marcarItemHandoffMcp = ferramenta({
  nome: "marcar_item_handoff",
  titulo: "Marcar item do checklist de handoff",
  descricao:
    "Marca (feito=true) ou desmarca um item manual do checklist de handoff: contatos, kickoff ou acessos. Proposta congelada é automática e o PDF do contrato usa definir_contrato_handoff. Só com o projeto na coluna Handoff.",
  escrita: true,
  guarda: checklistHandoffEditavel,
  entrada: { id, item: z.enum(ITENS_MANUAIS), feito: z.boolean() },
  executar: async (a, eu) => {
    const r = await marcarItemHandoff(a.id, a.item, a.feito, eu);
    return r.ok ? ok({ mudou: r.mudou, url: urlProjeto(a.id) }) : erro(MENSAGEM_ERRO_HANDOFF[r.erro]);
  },
});

const parteResumo = z.string().max(RESUMO_CAMPO_MAX, `Cada parte do resumo pode ter até ${RESUMO_CAMPO_MAX} caracteres.`).optional();

const escreverResumoHandoff = ferramenta({
  nome: "escrever_resumo_handoff",
  titulo: "Escrever o resumo de handoff",
  descricao:
    "Grava o resumo de handoff, escrito por vendas (só quem é do lado vendas). As quatro partes são obrigatórias para entrar em Execução: contexto, combinados (combinados verbais), riscos e valoriza (o que o cliente valoriza). Parte ausente fica como está; texto vazio limpa. Se não houver combinados ou riscos, escreva isso.",
  escrita: true,
  entrada: { id, contexto: parteResumo, combinados: parteResumo, riscos: parteResumo, valoriza: parteResumo },
  executar: async (a, eu) => {
    const r = await salvarResumoHandoff(a.id, { contexto: a.contexto, combinados: a.combinados, riscos: a.riscos, valoriza: a.valoriza }, eu);
    return r.ok ? ok({ mudou: r.mudou, url: urlProjeto(a.id) }) : erro(MENSAGEM_ERRO_HANDOFF[r.erro]);
  },
});

const designarGpProjeto = ferramenta({
  nome: "designar_gp_projeto",
  titulo: "Designar o GP do projeto",
  descricao: "Só o PM de projetos, com o projeto em Handoff ou Execução: designa o GP do projeto (uma pessoa da área projetos; candidatos em ler_handoff ou ver_cronograma). Ela vira a responsável pelo projeto e recebe o aviso. Designar de novo a mesma pessoa a devolve à responsabilidade, se o responsável tiver mudado.",
  escrita: true,
  entrada: { id, gp_id: id },
  executar: async (a, eu) => {
    const r = await designarGpDoProjeto(a.id, a.gp_id, eu);
    return r.ok ? ok({ mudou: r.mudou, url: urlProjeto(a.id) }) : erro(MENSAGEM_ERRO_HANDOFF[r.erro]);
  },
});

const definirContratoHandoff = ferramenta({
  nome: "definir_contrato_handoff",
  titulo: "Definir o PDF do contrato assinado no handoff",
  descricao:
    "Cumpre o item PDF do contrato assinado do checklist. anexo_id aponta um PDF já anexado ao projeto (listar_anexos); pdf_base64 (PDF de até 7,8 MB; maior que isso, use a tela) anexa o arquivo, com pdf_nome opcional. Envie um dos dois. Substitui o contrato definido antes. Só com o projeto na coluna Handoff.",
  escrita: true,
  guarda: checklistHandoffEditavel,
  entrada: {
    id,
    anexo_id: id.optional(),
    pdf_nome: z.string().max(1000).optional(),
    pdf_base64: z.string().max(PDF_BASE64_MAX, "PDF grande demais para o conector: o limite é 7,8 MB. Anexe pela tela do CRM.").optional(),
  },
  executar: async (a, eu) => {
    if ((a.anexo_id === undefined) === (a.pdf_base64 === undefined)) return erro("Envie anexo_id ou pdf_base64 (um dos dois). Nada foi alterado.");
    if (a.anexo_id !== undefined) {
      const r = await definirContratoNoHandoff(a.id, a.anexo_id, eu);
      return r.ok ? ok({ mudou: r.mudou, url: urlProjeto(a.id) }) : erro(MENSAGEM_ERRO_HANDOFF[r.erro]);
    }
    if (!BASE64.test(a.pdf_base64!)) return erro("pdf_base64 não é base64 válido.");
    const r = await anexarContratoNoHandoff(a.id, { nome: a.pdf_nome?.trim() || "Contrato assinado.pdf", bytes: new Uint8Array(Buffer.from(a.pdf_base64!, "base64")) }, eu);
    return r.ok ? ok({ anexo: r.anexo, url: urlProjeto(a.id) }) : erro(MENSAGEM_ERRO_HANDOFF[r.erro]);
  },
});

const moverParaExecucaoMcp = ferramenta({
  nome: "mover_para_execucao",
  titulo: "Mover o projeto para Execução",
  descricao: "Leva o projeto ao marco Execução. Só com o handoff completo (GP, checklist e resumo; veja ler_handoff), nem gestor força: a recusa diz o que falta.",
  escrita: true,
  guarda: cardEditavel,
  entrada: { id },
  executar: async (a, eu) => {
    const r = await moverParaExecucao(a.id, eu);
    return r.ok ? ok({ mudou: r.mudou, url: urlProjeto(a.id) }) : erro(r.erro);
  },
});

export const FERRAMENTAS: readonly Ferramenta[] = [
  listarFases,
  listarPessoas,
  buscarProjetos,
  lerProjeto,
  criarProjeto,
  atualizarProjeto,
  definirProximaAcao,
  moverProjeto,
  marcarContratoAssinadoMcp,
  lerHandoff,
  marcarItemHandoffMcp,
  escreverResumoHandoff,
  designarGpProjeto,
  definirContratoHandoff,
  moverParaExecucaoMcp,
  registrarNota,
  buscarEmpresasContatos,
  vincularEmpresaContato,
  criarPrazoMcp,
  concluirPrazo,
  listarAnexosMcp,
  lerAnexo,
  consultarPainelVendas,
  lerProposta,
  criarPropostaMcp,
  editarPropostaMcp,
  salvarVersaoMcp,
  listarVersoesMcp,
  lerVersaoMcp,
  passarCanetaMcp,
  devolverMcp,
  concordarMcp,
  pegarCanetaMcp,
  reabrirMcp,
  inviavelMcp,
  verDiffMcp,
  preencherPropostaDeAnexo,
  listarAvisosMcp,
  marcarAvisosLidosMcp,
  gerarPdfMcp,
  marcarEnviadaMcp,
  registrarRespostaMcp,
  concluirRevisaoMcp,
  // GAB-91: comentários na proposta (src/lib/mcp/comentarios.ts).
  ...FERRAMENTAS_COMENTARIOS,
  // GAB-95: cronograma e check-in (src/lib/mcp/execucao.ts).
  ...FERRAMENTAS_EXECUCAO,
  // GAB-96: painel de projetos (src/lib/mcp/painel-projetos.ts).
  ...FERRAMENTAS_PAINEL_PROJETOS,
];

function resultado(r: Resposta): CallToolResult {
  if (!r.ok) return { isError: true, content: [{ type: "text", text: r.erro }] };
  return { content: [{ type: "text", text: JSON.stringify(r.dados, null, 2) }] };
}

/**
 * Porta única de execução (o servidor MCP e os testes passam por aqui):
 * valida argumentos, aplica a permissão do papel e a guarda da ferramenta, e marca "via MCP".
 */
export async function executarFerramenta(nome: string, args: unknown, eu: UsuarioMcp): Promise<CallToolResult> {
  const f = FERRAMENTAS.find((x) => x.nome === nome);
  if (!f) return resultado(erro(`Ferramenta desconhecida: ${nome}.`));
  if (f.escrita && !podeEscrever(eu.papel)) return resultado(erro(SO_LEITURA));
  const p = z.object(f.entrada).safeParse(args ?? {});
  if (!p.success) {
    const i = p.error.issues[0];
    return resultado(erro(`Argumento inválido${i.path.length ? ` em ${i.path.join(".")}` : ""}: ${i.message}`));
  }
  try {
    return resultado(
      await comViaMcp(async () => {
        const recusa = await f.guarda?.(p.data, eu);
        return recusa ? erro(recusa) : f.executar(p.data, eu);
      }),
    );
  } catch (e) {
    const ref = registrarErro(`mcp.${nome}`, e);
    return resultado(erro(mensagemInesperada(ref)));
  }
}
