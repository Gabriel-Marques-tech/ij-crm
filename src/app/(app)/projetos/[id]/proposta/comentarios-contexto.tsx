"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DocumentoView } from "@/components/propostas/documento-view";
import type { EntradaDestaques } from "@/components/propostas/destaques-editor";
import { ancoraDaSelecaoDom } from "@/components/propostas/selecao-dom";
import { ancoraDoBloco, localizarAncora, textoPlano, type Ancora, type Destaque } from "@/lib/propostas/ancora";
import { ROTULO_CAMPO, type CampoComentario } from "@/lib/propostas/comentarios-limites";
import { normalizarDocumento, type Documento, type TipoBlocoDados } from "@/lib/propostas/documento";
import { ancoraDaLinha, localizarSugestao } from "@/lib/propostas/sugestao-trecho";
import type { Estruturado } from "@/lib/propostas/estruturado";

/** Polling dos comentários: ≤ ~10 s para aparecer em outra tela. Pausa com a aba oculta. */
export const INTERVALO_COMENTARIOS_MS = 5_000;
/** O editor informa o texto a cada tecla: recalcula "trecho alterado" só depois de uma pausa. */
export const ATRASO_TEXTO_MS = 300;
export const SESSAO_EXPIRADA = "Sessão expirada: recarregue a página para ver comentários novos.";

export type ComentarioJson = { id: string; autor: { id: string; nome: string }; texto: string; criadoEm: string; viaMcp: boolean; pendente: boolean };
export type SugestaoJson = { texto: string; aplicada: { por: string | null; em: string } | null; desatualizada: boolean };
export type ThreadJson = ComentarioJson & {
  ancora: Ancora | null;
  campo: CampoComentario | null;
  sugestao: SugestaoJson | null;
  trechoAlterado: boolean;
  resolvido: { por: string | null; em: string } | null;
  respostas: ComentarioJson[];
};

/** O editor manda o documento cru ("a  b"): compara no formato canônico, como o servidor. */
const planoCanonico = (d: Documento) => textoPlano(normalizarDocumento(d)).texto;

/** A id do destaque do trecho que está sendo comentado, antes de existir comentário. */
export const ID_CITADO = "citado";

/** O que a folha ativa (editor ou leitura) sabe responder sobre o próprio texto. */
export type FonteFolha = {
  selecao: () => Ancora | null;
  /** O "+" da linha: o bloco inteiro daquele elemento. */
  doElemento: (el: Element) => Ancora | null;
  /** Altura na tela de cada âncora (a conversa resolvida, sem destaque). */
  topos: (itens: readonly { id: string; ancora: Ancora }[]) => Record<string, number>;
};

/** Aplica a sugestão no editor e na fila do autosave. Devolve o texto do erro, ou null. */
export type Aplicador = (t: ThreadJson) => Promise<string | null>;

export function mensagemErro(ref?: string): string {
  return ref ? `Erro no servidor (ref: ${ref}). Tente de novo; se persistir, informe a ref.` : "Não deu para falar com o servidor. Tente de novo.";
}

type Contexto = {
  projetoId: string;
  euId: string;
  threads: ThreadJson[];
  erroCarga: string | null;
  recarregar: () => Promise<void>;
  /** Trecho "alterado" contra o texto que ESTA tela mostra (editor ao vivo ou leitura). */
  alterado: (t: ThreadJson) => boolean;
  ativo: string | null;
  ativar: (id: string | null, origem: "texto" | "painel") => void;
  /** Trecho citado esperando o comentário (o botão "Comentar trecho" preenche). */
  citado: Ancora | null;
  citar: (a: Ancora | null, opcoes?: { sugerir?: boolean }) => void;
  /** O formulário está propondo o texto novo do trecho citado. */
  sugerindo: boolean;
  /** Campo dos dados citado (no lugar do trecho). */
  campoCitado: CampoComentario | null;
  citarCampo: (campo: CampoComentario) => void;
  /** Incrementa a cada citação: o formulário foca o campo. */
  pedidoFoco: number;
  /** A fonte ativa (editor ou leitura) se registra aqui. */
  registrarFonte: (f: FonteFolha) => () => void;
  lerSelecao: () => Ancora | null;
  ancoraDoElemento: (el: Element) => Ancora | null;
  toposDasAncoras: FonteFolha["topos"];
  /** Só o editor de quem tem a caneta registra: sem ele, ninguém aplica nesta tela. */
  aplicador: Aplicador | null;
  registrarAplicador: (a: Aplicador) => () => void;
  /** Sugestão ainda aplicável contra o texto que ESTA tela mostra. */
  desatualizada: (t: ThreadJson) => boolean;
  /** Comentários e respostas meus, à espera de "Enviar revisão". */
  pendentes: number;
  informarTexto: (d: Documento) => void;
  /** Threads abertas com trecho: o que se destaca no texto. */
  ancoras: { id: string; ancora: Ancora }[];
  /** Rascunhos ("novo" ou id da thread): aqui, para não sumirem ao fechar o painel no celular. */
  rascunhos: Record<string, string>;
  escreverRascunho: (chave: string, texto: string) => void;
  /** Citação nova ainda sem foco no campo: reabrir o painel depois não abre o teclado. */
  consumirFoco: () => boolean;
  /** Incrementa quando tocam num trecho destacado na leitura: no celular, abre o painel de comentários. */
  pedidoPainel: number;
};

const Ctx = createContext<Contexto | null>(null);

/** null fora do provider (ex.: testes do painel da proposta): tudo de comentário some. */
export function useComentarios(): Contexto | null {
  return useContext(Ctx);
}

/**
 * Comentários da proposta ao vivo (GAB-91): carga inicial do servidor e
 * polling barato (`?v=`: o servidor só lista quando algo mudou) a cada 5 s,
 * pausado com a aba oculta e retomado na volta.
 */
export function ComentariosProvider({ projetoId, euId, inicial, children }: { projetoId: string; euId: string; inicial: { versao: string; threads: ThreadJson[] }; children: ReactNode }) {
  const [threads, setThreads] = useState(inicial.threads);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [citado, setCitado] = useState<Ancora | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [campoCitado, setCampoCitado] = useState<CampoComentario | null>(null);
  const [aplicador, setAplicador] = useState<Aplicador | null>(null);
  const [pedidoFoco, setPedidoFoco] = useState(0);
  const [texto, setTexto] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [pedidoPainel, setPedidoPainel] = useState(0);
  const escreverRascunho = useCallback((chave: string, valor: string) => setRascunhos((r) => ({ ...r, [chave]: valor })), []);
  const focoPendente = useRef(false);
  const versao = useRef(inicial.versao);
  const fonte = useRef<FonteFolha | null>(null);
  // Respostas fora de ordem (polling + recarga depois de comentar): só a da última requisição vale.
  const requisicao = useRef(0);
  // Requisições em andamento: o tick do polling não empilha outra (rede lenta > 5 s
  // faria toda resposta chegar "velha" pelo contador e a tela nunca atualizar).
  const emAndamento = useRef(0);
  const [expirada, setExpirada] = useState(false);

  const recarregar = useCallback(async () => {
    const minha = ++requisicao.current;
    emAndamento.current++;
    try {
      const r = await fetch(`/api/projetos/${encodeURIComponent(projetoId)}/comentarios?v=${encodeURIComponent(versao.current)}`, { cache: "no-store" });
      const corpo = (await r.json().catch(() => ({}))) as { versao?: string; comentarios?: ThreadJson[]; ref?: string };
      if (minha !== requisicao.current) return;
      if (r.status === 401) {
        // Sessão expirou: para o polling (não adianta insistir) e diz o que fazer.
        setExpirada(true);
        setErroCarga(SESSAO_EXPIRADA);
        return;
      }
      if (!r.ok) {
        // 404 não tem ref: a proposta sumiu — a próxima navegação resolve.
        if (corpo.ref) setErroCarga(mensagemErro(corpo.ref));
        return;
      }
      setErroCarga(null);
      // Sessão voltou (ex.: recarga depois de uma ação respondeu ok): o polling retoma.
      setExpirada(false);
      if (corpo.versao) versao.current = corpo.versao;
      if (corpo.comentarios) setThreads(corpo.comentarios);
    } catch {
      // Rede oscilou: mantém o que tem; a próxima rodada tenta de novo.
    } finally {
      emAndamento.current--;
    }
  }, [projetoId]);

  useEffect(() => {
    if (expirada) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (emAndamento.current === 0) void recarregar();
    };
    const parar = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const iniciar = () => {
      parar();
      timer = setInterval(tick, INTERVALO_COMENTARIOS_MS);
    };
    const aoMudarVisibilidade = () => {
      if (document.hidden) return parar();
      tick();
      iniciar();
    };
    if (!document.hidden) iniciar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [recarregar, expirada]);

  const ativar = useCallback((id: string | null, origem: "texto" | "painel") => {
    setAtivo(id);
    if (!id) return;
    // Rola até o outro lado: clicou no texto → o comentário; no comentário → o trecho.
    // Sem trecho na tela (geral, campo, alterado), o próprio cartão.
    requestAnimationFrame(() => {
      const cartao = document.getElementById(`comentario-${id}`);
      const trecho = origem === "painel" ? document.querySelector(`[data-comentario="${CSS.escape(id)}"]`) : null;
      (trecho ?? cartao)?.scrollIntoView?.({ block: trecho ? "center" : "nearest", behavior: "smooth" });
    });
  }, []);

  // Clique num trecho destacado (editor ou leitura) ativa o comentário dele.
  useEffect(() => {
    const clique = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-comentario]");
      const id = el?.getAttribute("data-comentario");
      // O trecho citado (ainda sem comentário) também fica destacado: clicar nele não ativa nada.
      if (!el || !id || id === ID_CITADO) return;
      ativar(id, "texto");
      // No editor o toque é para pôr o cursor: não cobre o texto (o painel abre pelo botão).
      if (!el.closest(".ProseMirror")) setPedidoPainel((n) => n + 1);
    };
    document.addEventListener("click", clique);
    return () => document.removeEventListener("click", clique);
  }, [ativar]);

  const pedirFoco = useCallback(() => {
    focoPendente.current = true;
    setPedidoFoco((n) => n + 1);
  }, []);
  const citar = useCallback(
    (a: Ancora | null, opcoes?: { sugerir?: boolean }) => {
      setCitado(a);
      setCampoCitado(null);
      const sugerir = !!a && opcoes?.sugerir === true;
      setSugerindo(sugerir);
      // O texto novo começa do trecho: quem revisa muda só o que precisa.
      setRascunhos((r) => ({ ...r, sugestao: sugerir ? a!.trecho : "" }));
      if (a) pedirFoco();
    },
    [pedirFoco],
  );
  const citarCampo = useCallback(
    (campo: CampoComentario) => {
      setCitado(null);
      setSugerindo(false);
      setCampoCitado(campo);
      pedirFoco();
    },
    [pedirFoco],
  );
  const consumirFoco = useCallback(() => {
    const pendente = focoPendente.current;
    focoPendente.current = false;
    return pendente;
  }, []);
  const registrarFonte = useCallback((f: FonteFolha) => {
    fonte.current = f;
    return () => {
      if (fonte.current === f) fonte.current = null;
    };
  }, []);
  const lerSelecao = useCallback(() => fonte.current?.selecao() ?? null, []);
  const ancoraDoElemento = useCallback((el: Element) => fonte.current?.doElemento(el) ?? null, []);
  const toposDasAncoras = useCallback<FonteFolha["topos"]>((itens) => fonte.current?.topos(itens) ?? {}, []);
  const registrarAplicador = useCallback((a: Aplicador) => {
    setAplicador(() => a);
    return () => setAplicador((atual: Aplicador | null) => (atual === a ? null : atual));
  }, []);
  // Primeira vez na hora (a tela abre já certa); depois, com pausa (o editor chama a cada tecla).
  const atrasoTexto = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const jaInformou = useRef(false);
  const informarTexto = useCallback((d: Documento) => {
    clearTimeout(atrasoTexto.current);
    if (!jaInformou.current) {
      jaInformou.current = true;
      setTexto(planoCanonico(d));
      return;
    }
    atrasoTexto.current = setTimeout(() => setTexto(planoCanonico(d)), ATRASO_TEXTO_MS);
  }, []);
  useEffect(() => () => clearTimeout(atrasoTexto.current), []);
  const alterado = useCallback((t: ThreadJson) => (t.ancora ? (texto === null ? t.trechoAlterado : localizarAncora(texto, t.ancora) === null) : false), [texto]);

  const desatualizada = useCallback(
    (t: ThreadJson) => {
      if (!t.sugestao || t.sugestao.aplicada || !t.ancora) return false;
      return texto === null ? t.sugestao.desatualizada : localizarSugestao(texto, t.ancora) === null;
    },
    [texto],
  );

  // O trecho citado também se destaca: sem isso, focar o campo apagaria a seleção da tela.
  const ancoras = useMemo(() => {
    const abertas = threads.filter((t) => t.ancora && !t.resolvido).map((t) => ({ id: t.id, ancora: t.ancora! }));
    return citado ? [...abertas, { id: ID_CITADO, ancora: citado }] : abertas;
  }, [threads, citado]);
  const pendentes = useMemo(() => threads.reduce((n, t) => n + (t.pendente ? 1 : 0) + t.respostas.filter((r) => r.pendente).length, 0), [threads]);

  const valor = useMemo<Contexto>(
    () => ({
      projetoId,
      euId,
      threads,
      erroCarga,
      recarregar,
      alterado,
      ativo,
      ativar,
      citado,
      citar,
      sugerindo,
      campoCitado,
      citarCampo,
      pedidoFoco,
      registrarFonte,
      lerSelecao,
      ancoraDoElemento,
      toposDasAncoras,
      aplicador,
      registrarAplicador,
      desatualizada,
      pendentes,
      informarTexto,
      ancoras,
      rascunhos,
      escreverRascunho,
      consumirFoco,
      pedidoPainel,
    }),
    [projetoId, euId, threads, erroCarga, recarregar, alterado, ativo, ativar, citado, citar, sugerindo, campoCitado, citarCampo, pedidoFoco, registrarFonte, lerSelecao, ancoraDoElemento, toposDasAncoras, aplicador, registrarAplicador, desatualizada, pendentes, informarTexto, ancoras, rascunhos, escreverRascunho, consumirFoco, pedidoPainel],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Entrada da decoração do editor (memo: só muda com os comentários ou o ativo). */
export function useDestaquesDoEditor(): EntradaDestaques | undefined {
  const c = useComentarios();
  const ancoras = c?.ancoras;
  const ativo = c?.ativo ?? null;
  return useMemo(() => (ancoras ? { destaques: ancoras, ativo } : undefined), [ancoras, ativo]);
}

/**
 * "Comentar trecho": lê a seleção da fonte ativa (editor ou leitura). O
 * `mousedown` não tira o foco/seleção do texto (como a barra do editor).
 */
export function BotaoComentarTrecho({ compacto = false }: { compacto?: boolean }) {
  const c = useComentarios();
  const [dica, setDica] = useState<string | null>(null);
  if (!c) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {dica ? (
        <span role="status" className="text-xs text-fg-mute">
          {dica}
        </span>
      ) : null}
      <Button
        type="button"
        size={compacto ? "icon-xs" : "xs"}
        variant="outline"
        aria-label="Comentar trecho"
        title="Comentar trecho"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const a = c.lerSelecao();
          setDica(a ? null : "Selecione um trecho do texto (até 500 caracteres) e clique de novo.");
          if (a) c.citar(a);
        }}
      >
        <MessageSquarePlus className="size-3.5" />
        {compacto ? null : " Comentar trecho"}
      </Button>
    </span>
  );
}

/** Leitura do rascunho (quem não está com a caneta) com os trechos comentados realçados e seleção comentável. */
export function TextoComentavel({ documento, dados }: { documento: Documento; dados?: Estruturado }) {
  const c = useComentarios();
  const raiz = useRef<HTMLDivElement>(null);
  const plano = useMemo(() => textoPlano(documento).texto, [documento]);
  const informar = c?.informarTexto;
  const registrar = c?.registrarFonte;
  useEffect(() => informar?.(documento), [informar, documento]);
  useEffect(
    () =>
      registrar?.({
        selecao: () => (raiz.current ? ancoraDaSelecaoDom(raiz.current, plano) : null),
        doElemento: (el) => {
          const tipo = el.getAttribute("data-bloco") as TipoBlocoDados | null;
          if (tipo) return ancoraDoBloco(documento, tipo);
          const pedaco = el.querySelector("[data-o]");
          return pedaco ? ancoraDaLinha(plano, Number(pedaco.getAttribute("data-o")), (el.textContent ?? "").length) : null;
        },
        topos: (itens) => {
          const pedacos = [...(raiz.current?.querySelectorAll<HTMLElement>("[data-o]") ?? [])];
          const topos: Record<string, number> = {};
          for (const i of itens) {
            const f = localizarAncora(plano, i.ancora);
            // Último pedaço que começa antes do trecho: é a linha dele, mesmo sem marca própria.
            const el = f && pedacos.findLast((p) => Number(p.dataset.o) <= f.inicio);
            if (el) topos[i.id] = el.getBoundingClientRect().top;
          }
          return topos;
        },
      }),
    [registrar, plano, documento],
  );
  const destaques = useMemo<Destaque[]>(
    () =>
      (c?.ancoras ?? []).flatMap((a) => {
        const f = localizarAncora(plano, a.ancora);
        return f ? [{ id: a.id, ...f }] : [];
      }),
    [c?.ancoras, plano],
  );
  return (
    <div ref={raiz}>
      <DocumentoView documento={documento} destaques={destaques} ativo={c?.ativo ?? null} dados={dados} controlesBloco={c ? (tipo) => <ComentarBloco documento={documento} tipo={tipo} /> : undefined} />
    </div>
  );
}

/** Comentar um dado da proposta, ao lado do rótulo dele. Fora do provider (versões), não aparece. */
export function BotaoComentarCampo({ campo, className }: { campo: CampoComentario; className?: string }) {
  const c = useComentarios();
  if (!c) return null;
  const rotulo = `Comentar ${ROTULO_CAMPO[campo].toLowerCase()}`;
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      className={cn("ml-1 inline-flex size-4 items-center justify-center rounded align-text-bottom text-fg-faint hover:bg-surface-hover hover:text-foreground", className)}
      onClick={() => c.citarCampo(campo)}
    >
      <MessageSquarePlus className="size-3" />
    </button>
  );
}

/** Comentar o bloco inteiro: a âncora é o título dele, no lugar em que está (GAB-100). */
function ComentarBloco({ documento, tipo }: { documento: Documento; tipo: TipoBlocoDados }) {
  const c = useComentarios();
  if (!c) return null;
  return (
    <span className="bloco-dados-controles">
      <button
        type="button"
        aria-label="Comentar o bloco"
        title="Comentar o bloco"
        className="inline-flex size-6 items-center justify-center rounded-md text-fg-soft hover:bg-surface-hover hover:text-foreground"
        onClick={() => {
          const a = ancoraDoBloco(documento, tipo);
          if (a) c.citar(a);
        }}
      >
        <MessageSquarePlus className="size-3.5" />
      </button>
    </span>
  );
}
