/**
 * Ferramentas MCP de comentários na proposta (GAB-91, GAB-101). Só traduzem argumentos
 * e chamam `lib/propostas/comentarios` — a mesma camada da tela, com as mesmas
 * permissões: quem vê a proposta e está ativo comenta, responde, resolve e reabre
 * (GAB-98: o serviço confere; ler passa pela guarda). `escrita: false` porque a
 * regra não é a do papel; `muda: true` nas que gravam (sem `readOnlyHint`).
 */
import { z } from "zod";
import {
  COMENTARIO_MAX,
  comentar,
  descartarPendente,
  enviarRevisao,
  listarComentarios,
  MENSAGEM_ERRO_COMENTARIO,
  reabrirComentario,
  resolverComentario,
  responderComentario,
  type ComentarioLido,
  type ErroComentario,
} from "@/lib/propostas/comentarios";
import { CAMPOS_COMENTARIO, ROTULO_CAMPO, SUGESTAO_MAX } from "@/lib/propostas/comentarios-limites";
import { trechoLegivel, TRECHO_MAX } from "@/lib/propostas/ancora";
import type { Ferramenta, Resposta } from "./ferramentas";
import { propostaVisivel } from "./guardas";
import { urlBase } from "./url";

type Forma = z.ZodRawShape;
const ferramenta = <F extends Forma>(f: Ferramenta<F>) => f as unknown as Ferramenta;
const id = z.string().min(1).max(64);
const texto = z.string().min(1).max(COMENTARIO_MAX);
const ok = (dados: unknown): Resposta => ({ ok: true, dados });
const falha = (r: { ok: false; erro: ErroComentario }): Resposta => ({ ok: false, erro: MENSAGEM_ERRO_COMENTARIO[r.erro] });
const urlProposta = (pid: string) => `${urlBase()}/projetos/${pid}/proposta`;

const item = (c: ComentarioLido) => ({ id: c.id, autor: c.autor.nome, texto: c.texto, em: c.criadoEm.toISOString(), ...(c.viaMcp ? { viaMcp: true } : {}), ...(c.pendente ? { pendente: true } : {}) });
const campo = z.enum(CAMPOS_COMENTARIO);
const NOTA_CAMPO = `\`campo\` prende o comentário a um dado da proposta (${CAMPOS_COMENTARIO.join(", ")}), sem \`trecho\`.`;

const listar = ferramenta({
  nome: "listar_comentarios_proposta",
  titulo: "Listar comentários da proposta",
  descricao:
    "Comentários da proposta do projeto, em threads (mais antigos primeiro): autor, texto, trecho citado (null = comentário geral), `campo`, `trecho_alterado` (o trecho não está mais no texto atual), `sugestao` (texto novo proposto, se já foi aplicada e se está desatualizada), respostas e se está resolvido. Os seus comentários ainda não enviados vêm com `pendente: true`; os de outras pessoas nunca aparecem. Por padrão só os abertos; `incluir_resolvidos: true` traz todos.",
  escrita: false,
  guarda: propostaVisivel,
  entrada: { projeto_id: id, incluir_resolvidos: z.boolean().optional() },
  executar: async (a, eu) => {
    const l = await listarComentarios(a.projeto_id, eu);
    if (!l) return { ok: false, erro: "Projeto não encontrado ou sem proposta." };
    const threads = a.incluir_resolvidos ? l.threads : l.threads.filter((t) => !t.resolvido);
    return ok({
      total: l.threads.filter((t) => !t.pendente).length,
      abertos: l.threads.filter((t) => !t.resolvido && !t.pendente).length,
      pendentes_da_sua_revisao: l.threads.reduce((n, t) => n + (t.pendente ? 1 : 0) + t.respostas.filter((r) => r.pendente).length, 0),
      comentarios: threads.map((t) => ({
        ...item(t),
        trecho: t.ancora ? trechoLegivel(t.ancora.trecho) : null,
        ...(t.ancora ? { trecho_alterado: t.trechoAlterado } : {}),
        ...(t.campo ? { campo: t.campo, campo_rotulo: ROTULO_CAMPO[t.campo] } : {}),
        ...(t.sugestao ? { sugestao: { texto: t.sugestao.texto, desatualizada: t.sugestao.desatualizada, aplicada: t.sugestao.aplicada ? { por: t.sugestao.aplicada.por, em: t.sugestao.aplicada.em.toISOString() } : null } } : {}),
        resolvido: t.resolvido ? { por: t.resolvido.por, em: t.resolvido.em.toISOString() } : null,
        respostas: t.respostas.map(item),
      })),
      url: urlProposta(a.projeto_id),
    });
  },
});

const comentarMcp = ferramenta({
  nome: "comentar_proposta",
  titulo: "Comentar na proposta",
  descricao: `Comenta na proposta do projeto (qualquer etapa; não precisa da caneta e não edita o texto). Sem \`trecho\`: comentário geral. Com \`trecho\`: preso a esse trecho do texto ATUAL — cite o texto exato como aparece (até ${TRECHO_MAX} caracteres, sem a marcação Markdown como ** ou #); se aparecer mais de uma vez, vale a primeira. Para comentar o bloco Cronograma ou Investimento, cite o título dele; se a mesma palavra existir no texto, vale o texto. ${NOTA_CAMPO} O dono da caneta é avisado no app. Texto puro, até ${COMENTARIO_MAX} caracteres.`,
  escrita: false,
  muda: true,
  entrada: { projeto_id: id, texto, trecho: z.string().min(1).max(TRECHO_MAX).optional(), campo: campo.optional() },
  executar: async (a, eu) => {
    const r = await comentar(a.projeto_id, { texto: a.texto, trecho: a.trecho ?? null, campo: a.campo ?? null }, eu);
    return r.ok ? ok({ id: r.comentario.id, url: urlProposta(a.projeto_id) }) : falha(r);
  },
});

const responderMcp = ferramenta({
  nome: "responder_comentario_proposta",
  titulo: "Responder comentário da proposta",
  descricao: `Responde na thread do comentário \`comentario_id\` (de listar_comentarios_proposta; responder a uma resposta entra na mesma thread). Texto puro, até ${COMENTARIO_MAX} caracteres.`,
  escrita: false,
  muda: true,
  entrada: { comentario_id: id, texto },
  executar: async (a, eu) => {
    const r = await responderComentario(a.comentario_id, a.texto, eu);
    return r.ok ? ok({ id: r.comentario.id }) : falha(r);
  },
});

const resolverMcp = ferramenta({
  nome: "resolver_comentario_proposta",
  titulo: "Resolver comentário da proposta",
  descricao: "Marca a thread do comentário como resolvida (fica registrado na Timeline do projeto, com você como autor).",
  escrita: false,
  muda: true,
  entrada: { comentario_id: id },
  executar: async (a, eu) => {
    const r = await resolverComentario(a.comentario_id, eu);
    return r.ok ? ok({ resolvido: true }) : falha(r);
  },
});

const reabrirMcp = ferramenta({
  nome: "reabrir_comentario_proposta",
  titulo: "Reabrir comentário da proposta",
  descricao: "Reabre uma thread de comentário resolvida (fica registrado na Timeline do projeto).",
  escrita: false,
  muda: true,
  entrada: { comentario_id: id },
  executar: async (a, eu) => {
    const r = await reabrirComentario(a.comentario_id, eu);
    return r.ok ? ok({ resolvido: false }) : falha(r);
  },
});

const sugerirMcp = ferramenta({
  nome: "sugerir_texto_proposta",
  titulo: "Sugerir texto na proposta",
  descricao: `Propõe o texto novo de um trecho do texto ATUAL da proposta, sem editar: quem está com a caneta aplica na tela, e se o trecho mudar antes disso a sugestão fica desatualizada. \`trecho\`: texto exato de um mesmo bloco, sem marcação Markdown (até ${TRECHO_MAX} caracteres; se aparecer mais de uma vez, vale a primeira). \`texto_novo\`: texto puro de uma linha, até ${SUGESTAO_MAX} caracteres; vazio apaga o trecho. Dados e blocos Cronograma e Investimento não aceitam sugestão. \`em_revisao: true\` guarda na sua revisão, em vez de publicar agora (enviar_revisao_proposta publica).`,
  escrita: false,
  muda: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: id, trecho: z.string().min(1).max(TRECHO_MAX), texto_novo: z.string().max(SUGESTAO_MAX), texto: z.string().max(COMENTARIO_MAX).optional(), em_revisao: z.boolean().optional() },
  executar: async (a, eu) => {
    const r = await comentar(a.projeto_id, { texto: a.texto ?? "", trecho: a.trecho, sugestao: a.texto_novo, pendente: a.em_revisao === true }, eu);
    return r.ok ? ok({ id: r.comentario.id, pendente: a.em_revisao === true, url: urlProposta(a.projeto_id) }) : falha(r);
  },
});

const adicionarMcp = ferramenta({
  nome: "adicionar_a_revisao_proposta",
  titulo: "Adicionar comentário à revisão",
  descricao: `Guarda um comentário na sua revisão da proposta: só você vê, não conta como aberto e ninguém é avisado até enviar_revisao_proposta. Sem \`trecho\` nem \`campo\`: geral. \`trecho\`: como em comentar_proposta. ${NOTA_CAMPO} \`comentario_id\`: em vez disso, responde nessa thread. Texto puro, até ${COMENTARIO_MAX} caracteres.`,
  escrita: false,
  muda: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: id, texto, trecho: z.string().min(1).max(TRECHO_MAX).optional(), campo: campo.optional(), comentario_id: id.optional() },
  executar: async (a, eu) => {
    const r = a.comentario_id ? await responderComentario(a.comentario_id, a.texto, eu, { pendente: true }) : await comentar(a.projeto_id, { texto: a.texto, trecho: a.trecho ?? null, campo: a.campo ?? null, pendente: true }, eu);
    return r.ok ? ok({ id: r.comentario.id, pendente: true }) : falha(r);
  },
});

const enviarMcp = ferramenta({
  nome: "enviar_revisao_proposta",
  titulo: "Enviar revisão da proposta",
  descricao: "Publica todos os seus comentários pendentes nesta proposta. O dono da caneta recebe um único aviso no app.",
  escrita: false,
  muda: true,
  guarda: propostaVisivel,
  entrada: { projeto_id: id },
  executar: async (a, eu) => {
    const r = await enviarRevisao(a.projeto_id, eu);
    return r.ok ? ok({ publicados: r.publicados, url: urlProposta(a.projeto_id) }) : falha(r);
  },
});

const descartarMcp = ferramenta({
  nome: "descartar_da_revisao_proposta",
  titulo: "Descartar comentário da revisão",
  descricao: "Tira da sua revisão um comentário ainda pendente (de listar_comentarios_proposta). Comentário já publicado não sai por aqui.",
  escrita: false,
  muda: true,
  entrada: { comentario_id: id },
  executar: async (a, eu) => {
    const r = await descartarPendente(a.comentario_id, eu);
    return r.ok ? ok({ descartado: true }) : falha(r);
  },
});

export const FERRAMENTAS_COMENTARIOS: readonly Ferramenta[] = [listar, comentarMcp, responderMcp, resolverMcp, reabrirMcp, sugerirMcp, adicionarMcp, enviarMcp, descartarMcp];
