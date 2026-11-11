"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, MessageSquare, MessageSquarePlus, PencilLine, RotateCcw, Send, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { DiffTexto } from "@/components/propostas/diff-view";
import { Button } from "@/components/ui/button";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { trechoLegivel } from "@/lib/propostas/ancora";
import { diffMarkdown } from "@/lib/propostas/diff";
import { posicoesNaMargem } from "@/lib/propostas/margem";
import { COMENTARIO_MAX, ROTULO_CAMPO, SUGESTAO_MAX } from "@/lib/propostas/comentarios-limites";
import { trechoSugerivel } from "@/lib/propostas/sugestao-trecho";
import { comentarAction, descartarPendenteAction, enviarRevisaoAction, resolverComentarioAction, responderComentarioAction, type RespostaComentario } from "./comentarios-actions";
import { mensagemErro, useComentarios, type ComentarioJson, type ThreadJson } from "./comentarios-contexto";

/** Resposta da action → texto de erro (com a ref do log quando inesperado), ou null. */
function erroDe(r: RespostaComentario | undefined): string | null {
  if (!r) return mensagemErro();
  if (r.ok) return null;
  return "ref" in r ? mensagemErro(r.ref) : r.erro;
}

/** Selo de estado do cartão: cor funcional só no ponto (§4.5.1). */
function Marca({ children, alerta }: { children: React.ReactNode; alerta?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-soft not-italic uppercase">
      <i aria-hidden className={cn("size-1.5 rounded-full", alerta ? "bg-warn" : "bg-fg-faint")} />
      {children}
    </span>
  );
}

/** Do trecho para o texto novo, palavra a palavra, como no diff de versões. */
function DiffSugestao({ antes, depois }: { antes: string; depois: string }) {
  const linhas = useMemo(() => diffMarkdown(trechoLegivel(antes), depois).filter((l) => l.tipo !== "igual"), [antes, depois]);
  return <DiffTexto linhas={linhas} />;
}

function Cabecalho({ c }: { c: ComentarioJson }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <b className="font-medium text-foreground">{c.autor.nome}</b>
      <span className="text-fg-faint">{formatarDataHora(new Date(c.criadoEm))}</span>
      {c.viaMcp ? <span className="font-mono text-[10px] text-fg-faint uppercase">via MCP</span> : null}
      {c.pendente ? <Marca>pendente</Marca> : null}
    </p>
  );
}

/** Texto puro: o React escapa; quebras de linha preservadas pelo CSS. */
function Texto({ texto }: { texto: string }) {
  return <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-fg-soft">{texto}</p>;
}

function CampoTexto({ valor, mudar, rotulo, campo }: { valor: string; mudar: (v: string) => void; rotulo: string; campo?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={campo}
      aria-label={rotulo}
      placeholder={rotulo}
      value={valor}
      maxLength={COMENTARIO_MAX}
      rows={2}
      onChange={(e) => mudar(e.target.value)}
      className="w-full resize-y rounded-lg border border-input bg-input/20 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
    />
  );
}

/** O que o cartão mostra do alvo: o trecho, ou o campo dos dados. */
function Alvo({ t, ativo, alterado }: { t: ThreadJson; ativo: boolean; alterado: boolean }) {
  const c = useComentarios()!;
  if (t.campo) {
    return (
      <button type="button" onClick={() => c.ativar(ativo ? null : t.id, "painel")} className="mb-2 block w-full rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-left font-mono text-[10px] text-fg-mute uppercase">
        Dados · {ROTULO_CAMPO[t.campo]}
      </button>
    );
  }
  if (!t.ancora) return <p className="mb-1 font-mono text-[10px] text-fg-faint uppercase">geral</p>;
  return (
    <button
      type="button"
      onClick={() => c.ativar(ativo ? null : t.id, "painel")}
      title={alterado ? "O trecho foi editado ou apagado do texto: este é o texto antigo" : "Mostrar o trecho no texto"}
      className="mb-2 block w-full rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-left text-xs text-fg-mute"
    >
      {alterado ? (
        <span className="mb-1 block">
          <Marca alerta>desatualizado</Marca>
        </span>
      ) : null}
      <span className="line-clamp-3 break-words italic">“{trechoLegivel(t.ancora.trecho)}”</span>
    </button>
  );
}

function Thread({ t, topo }: { t: ThreadJson; topo?: number }) {
  const c = useComentarios()!;
  const resposta = c.rascunhos[t.id] ?? "";
  const setResposta = (v: string) => c.escreverRascunho(t.id, v);
  const [respondendo, setRespondendo] = useState(resposta !== "");
  const [expandida, setExpandida] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();
  const alterado = c.alterado(t);
  const ativo = c.ativo === t.id;
  const desatualizada = c.desatualizada(t);

  function agir(fazer: () => Promise<RespostaComentario>, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      let r: RespostaComentario | undefined;
      try {
        r = await fazer();
      } catch {
        r = undefined;
      }
      const e = erroDe(r);
      if (e) return setErro(e);
      depois?.();
      await c.recarregar();
    });
  }

  function aplicar() {
    if (!c.aplicador) return;
    const aplicador = c.aplicador;
    setErro(null);
    startTransition(async () => {
      let e: string | null;
      try {
        e = await aplicador(t);
      } catch {
        e = mensagemErro();
      }
      if (e) setErro(e);
      await c.recarregar();
    });
  }

  const posicao = topo === undefined ? undefined : ({ position: "absolute", top: topo, left: 0, right: 0 } as const);

  // Resolver e recolher: a conversa resolvida vira uma linha fina, que abre ou reabre.
  if (t.resolvido && !expandida) {
    const quem = t.sugestao?.aplicada ? `Sugestão aplicada${t.sugestao.aplicada.por ? ` por ${t.sugestao.aplicada.por}` : ""}` : `Resolvido${t.resolvido.por ? ` por ${t.resolvido.por}` : ""}`;
    return (
      <li id={`comentario-${t.id}`} data-thread={t.id} style={posicao} className="flex min-h-7 scroll-mt-48 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-xs text-fg-mute">
        <button type="button" aria-expanded={false} aria-label={`Ver a conversa: ${quem}`} title={quem} className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left hover:text-foreground" onClick={() => setExpandida(true)}>
          <ChevronRight aria-hidden className="size-3 shrink-0" />
          <Check aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{quem}</span>
        </button>
        <button type="button" className="shrink-0 rounded px-1 py-0.5 hover:bg-surface-hover hover:text-foreground disabled:opacity-40" disabled={ocupado} onClick={() => agir(() => resolverComentarioAction(t.id, false))}>
          Reabrir
        </button>
        {erro ? (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li
      id={`comentario-${t.id}`}
      data-thread={t.id}
      style={posicao}
      className={cn("scroll-mt-48 rounded-lg border bg-surface p-3", t.pendente ? "border-dashed border-border-strong" : "border-border", ativo && "z-[1] border-warn bg-surface-strong")}
    >
      {/* Fio até a linha comentada: atravessa o vão entre a margem e a folha. */}
      {topo !== undefined && t.ancora && !alterado && !t.resolvido ? <span aria-hidden className="absolute top-4 -right-5 w-5 border-t border-dashed border-warn" /> : null}
      <Alvo t={t} ativo={ativo} alterado={alterado && !t.sugestao?.aplicada} />
      {t.sugestao && t.ancora ? (
        <div className="mb-2 space-y-1">
          <p className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-fg-faint uppercase">
            sugestão
            {desatualizada ? <Marca alerta>desatualizada</Marca> : null}
            {t.sugestao.aplicada ? <Marca>aplicada</Marca> : null}
          </p>
          <DiffSugestao antes={t.ancora.trecho} depois={t.sugestao.texto} />
          {t.sugestao.aplicada ? (
            <p className="text-xs text-fg-mute">
              Aplicada{t.sugestao.aplicada.por ? ` por ${t.sugestao.aplicada.por}` : ""} em {formatarDataHora(new Date(t.sugestao.aplicada.em))}
            </p>
          ) : !t.resolvido && !t.pendente && !desatualizada ? (
            c.aplicador ? (
              <Button type="button" size="xs" variant="outline" disabled={ocupado} onClick={aplicar}>
                <Check className="size-3" /> Aplicar sugestão
              </Button>
            ) : (
              <p className="text-[11px] text-fg-faint">Só quem está com a caneta aplica.</p>
            )
          ) : null}
        </div>
      ) : null}
      <Cabecalho c={t} />
      <Texto texto={t.texto} />
      {t.respostas.length ? (
        <ul className="mt-2 space-y-2 border-l border-border pl-3">
          {t.respostas.map((r) => (
            <li key={r.id}>
              <Cabecalho c={r} />
              <Texto texto={r.texto} />
              {r.pendente ? (
                <button type="button" className="text-[11px] text-fg-mute underline-offset-2 hover:underline" disabled={ocupado} onClick={() => agir(() => descartarPendenteAction(r.id))}>
                  Descartar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {t.resolvido ? (
        <p className="mt-2 text-xs text-fg-mute">
          <Check className="mr-1 inline size-3" />
          Resolvido{t.resolvido.por ? ` por ${t.resolvido.por}` : ""} em {formatarDataHora(new Date(t.resolvido.em))}
        </p>
      ) : null}
      {respondendo ? (
        <form
          className="mt-2 space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            agir(
              () => responderComentarioAction(t.id, resposta, t.pendente),
              () => {
                setResposta("");
                setRespondendo(false);
              },
            );
          }}
        >
          <CampoTexto valor={resposta} mudar={setResposta} rotulo="Sua resposta" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="xs" disabled={ocupado || !resposta.trim()}>
              {t.pendente ? "Adicionar à revisão" : "Responder agora"}
            </Button>
            {t.pendente ? null : (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={ocupado || !resposta.trim()}
                onClick={() =>
                  agir(
                    () => responderComentarioAction(t.id, resposta, true),
                    () => {
                      setResposta("");
                      setRespondendo(false);
                    },
                  )
                }
              >
                Adicionar à revisão
              </Button>
            )}
            <Button type="button" size="xs" variant="ghost" onClick={() => setRespondendo(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => setRespondendo(true)}>
            <MessageSquare className="size-3" /> Responder
          </Button>
          {t.pendente ? (
            <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => agir(() => descartarPendenteAction(t.id))}>
              <Trash2 className="size-3" /> Descartar
            </Button>
          ) : t.resolvido ? (
            <>
              <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => agir(() => resolverComentarioAction(t.id, false))}>
                <RotateCcw className="size-3" /> Reabrir
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setExpandida(false)}>
                Recolher
              </Button>
            </>
          ) : (
            <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => agir(() => resolverComentarioAction(t.id, true), () => setExpandida(false))}>
              <Check className="size-3" /> Resolver
            </Button>
          )}
        </div>
      )}
      {erro ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {erro}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Cartões na altura da linha comentada: o trecho é achado pelo `data-comentario` que a
 * folha põe nele (editor ou leitura). Roda de novo quando a folha ou os cartões mudam de
 * tamanho ou o destaque muda de lugar. Só mede e posiciona: não toca no documento.
 */
function usePosicoes(lista: React.RefObject<HTMLUListElement | null>, threads: ThreadJson[], ligado: boolean, toposDasAncoras?: (itens: { id: string; ancora: NonNullable<ThreadJson["ancora"]> }[]) => Record<string, number>) {
  const [posicoes, setPosicoes] = useState<{ topos: Record<string, number>; altura: number } | null>(null);
  const chave = threads.map((t) => `${t.id}:${t.resolvido ? 1 : 0}`).join();
  // Lidos na hora de medir: mudar de texto ou de lista não recria os observadores.
  const atual = useRef({ threads, toposDasAncoras });
  useLayoutEffect(() => {
    atual.current = { threads, toposDasAncoras };
  });
  useLayoutEffect(() => {
    const ul = lista.current;
    if (!ligado || !ul) return;
    const medir = () => {
      const base = ul.getBoundingClientRect().top;
      // Resolvida não tem destaque no texto: a linha fina fica na altura em que o trecho está.
      const resolvidas = atual.current.threads.flatMap((t) => (t.resolvido && t.ancora ? [{ id: t.id, ancora: t.ancora }] : []));
      const toposResolvidas = atual.current.toposDasAncoras?.(resolvidas) ?? {};
      const itens = [...ul.querySelectorAll<HTMLElement>("[data-thread]")].map((el) => {
        const id = el.dataset.thread!;
        const alvo = document.querySelector(`[data-comentario="${CSS.escape(id)}"]`);
        const topo = alvo ? alvo.getBoundingClientRect().top : toposResolvidas[id];
        return { id, alvo: topo === undefined ? null : topo - base, altura: el.offsetHeight };
      });
      const r = posicoesNaMargem(itens);
      setPosicoes((a) => (a && a.altura === r.altura && itens.every((i) => a.topos[i.id] === r.topos[i.id]) ? a : r));
    };
    let quadro = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    medir();
    const tamanho = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(agendar);
    tamanho?.observe(ul);
    ul.querySelectorAll("[data-thread]").forEach((el) => tamanho?.observe(el));
    // O editor carrega depois (só no navegador) e desenha os destaques depois: observa a grade toda.
    let folha: Element | null = null;
    const olharFolha = () => {
      const f = document.querySelector("[data-folha]");
      if (f && f !== folha) {
        if (folha) tamanho?.unobserve(folha);
        tamanho?.observe(f);
        folha = f;
      }
    };
    olharFolha();
    const mudancas =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            olharFolha();
            agendar();
          });
    mudancas?.observe(ul.closest(".grade-proposta") ?? document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-comentario"] });
    window.addEventListener("resize", agendar);
    return () => {
      cancelAnimationFrame(quadro);
      tamanho?.disconnect();
      mudancas?.disconnect();
      window.removeEventListener("resize", agendar);
    };
  }, [lista, ligado, chave]);
  return ligado ? posicoes : null;
}

/**
 * Comentários da proposta (GAB-91): qualquer pessoa logada comenta (geral ou
 * citando um trecho), responde, resolve e reabre — sem a caneta. Atualiza
 * sozinho pelo polling do `ComentariosProvider`.
 *
 * GAB-100, `alinhar`: é a margem esquerda da folha. Cartão na altura da linha, o de baixo
 * desce se colidir, e o formulário fica recolhido no topo fixo da coluna.
 *
 * GAB-101: revisão como a de um PR. Sugestão com diff, conversa resolvida em linha fina, "Comentar
 * agora" ou "Adicionar à revisão", e "Enviar revisão (N)".
 */
export function PainelComentarios({ alinhar = false }: { alinhar?: boolean }) {
  const c = useComentarios();
  const texto = c?.rascunhos.novo ?? "";
  const setTexto = (v: string) => c?.escreverRascunho("novo", v);
  const textoNovo = c?.rascunhos.sugestao ?? "";
  const [erro, setErro] = useState<string | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(true);
  const [ocupado, startTransition] = useTransition();
  const [formAberto, setFormAberto] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const pedidoFoco = c?.pedidoFoco ?? 0;
  // Pendente não conta como aberto: é só um rascunho publicado para o autor.
  const abertos = c?.threads.filter((t) => !t.resolvido && !t.pendente) ?? [];
  const resolvidos = c?.threads.filter((t) => t.resolvido).length ?? 0;
  const naoResolvidos = c?.threads.filter((t) => !t.resolvido) ?? [];
  const visiveis = verResolvidos ? (c?.threads ?? []) : naoResolvidos;
  const posicoes = usePosicoes(lista, visiveis, alinhar, c?.toposDasAncoras);

  const consumirFoco = c?.consumirFoco;
  useEffect(() => {
    if (consumirFoco?.()) campo.current?.focus({ preventScroll: alinhar });
  }, [pedidoFoco, alinhar, consumirFoco]);

  // Abriu o painel no celular a partir de um trecho: mostra o comentário dele.
  const ativo = c?.ativo ?? null;
  useEffect(() => {
    if (!alinhar && ativo) document.getElementById(`comentario-${ativo}`)?.scrollIntoView?.({ block: "nearest" });
  }, [alinhar, ativo]);

  if (!c) return null;
  const comForm = !alinhar || formAberto || !!c.citado || !!c.campoCitado || texto.trim() !== "";
  const podeSugerir = !!c.citado && trechoSugerivel(c.citado.trecho);
  const sugestaoMudou = c.sugerindo && !!c.citado && textoNovo.trim() !== c.citado.trecho;
  const podeEnviar = c.sugerindo ? sugestaoMudou : !!texto.trim();

  /** Setas: como os cartões estão na margem. Gerais, de campo e alterados no topo; depois os trechos, na ordem do texto. */
  function navegar(passo: -1 | 1) {
    const semTrecho = naoResolvidos.filter((t) => !t.ancora || c!.alterado(t));
    const comTrecho = naoResolvidos.filter((t) => t.ancora && !c!.alterado(t)).sort((a, b) => topoDoTrecho(a.id) - topoDoTrecho(b.id));
    const ordenados = [...semTrecho, ...comTrecho];
    if (ordenados.length === 0) return;
    const i = ordenados.findIndex((t) => t.id === c!.ativo);
    const prox = i === -1 ? (passo === 1 ? 0 : ordenados.length - 1) : (i + passo + ordenados.length) % ordenados.length;
    c!.ativar(ordenados[prox].id, "painel");
  }

  function fechar() {
    setTexto("");
    setFormAberto(false);
    c!.citar(null);
  }

  function enviar(pendente: boolean) {
    setErro(null);
    const citado = c!.citado;
    const extra = { pendente, ...(c!.campoCitado ? { campo: c!.campoCitado } : {}), ...(c!.sugerindo ? { sugestao: textoNovo } : {}) };
    startTransition(async () => {
      let r: RespostaComentario | undefined;
      try {
        r = await comentarAction(c!.projetoId, texto, citado, extra);
      } catch {
        r = undefined;
      }
      const e = erroDe(r);
      if (e) return setErro(e);
      fechar();
      await c!.recarregar();
    });
  }

  function enviarRevisao() {
    setErro(null);
    startTransition(async () => {
      let r: RespostaComentario | undefined;
      try {
        r = await enviarRevisaoAction(c!.projetoId);
      } catch {
        r = undefined;
      }
      const e = erroDe(r);
      if (e) setErro(e);
      await c!.recarregar();
    });
  }

  return (
    <section className={alinhar ? "flex-1" : "rounded-xl border border-border bg-surface p-4"} aria-label="Comentários">
      <div className={cn("mb-3", alinhar && "sticky top-14 z-[4] -mx-1 max-h-[calc(100vh-4rem)] overflow-y-auto bg-background px-1 pt-1 pb-2")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="sr-only">Comentários</h2>
          <span className="eyebrow">
            {abertos.length} {abertos.length === 1 ? "aberto" : "abertos"} · {resolvidos} {resolvidos === 1 ? "resolvido" : "resolvidos"}
          </span>
          <span className="flex-1" />
          <span className="flex">
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Comentário anterior" title="Anterior" disabled={naoResolvidos.length === 0} onClick={() => navegar(-1)}>
              <ChevronUp />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Próximo comentário" title="Próximo" disabled={naoResolvidos.length === 0} onClick={() => navegar(1)}>
              <ChevronDown />
            </Button>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {alinhar && !comForm ? (
            <Button type="button" size="xs" variant="outline" onClick={() => setFormAberto(true)}>
              <MessageSquarePlus className="size-3" /> Comentário geral
            </Button>
          ) : null}
          {c.pendentes ? (
            <Button type="button" size="xs" variant="outline" disabled={ocupado} onClick={enviarRevisao}>
              <Send className="size-3" /> Enviar revisão ({c.pendentes})
            </Button>
          ) : null}
          {resolvidos ? (
            <button type="button" className="text-xs text-fg-mute underline-offset-2 hover:underline" onClick={() => setVerResolvidos((v) => !v)}>
              {verResolvidos ? "Esconder resolvidos" : `Ver resolvidos (${resolvidos})`}
            </button>
          ) : null}
        </div>

        {comForm ? (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              enviar(false);
            }}
          >
            {c.citado || c.campoCitado ? (
              <div className="flex items-start gap-1 rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-xs text-fg-mute">
                <span className="line-clamp-3 flex-1 break-words italic">{c.citado ? `“${trechoLegivel(c.citado.trecho)}”` : `Dados · ${ROTULO_CAMPO[c.campoCitado!]}`}</span>
                <button type="button" aria-label="Tirar o trecho citado" className="text-fg-faint hover:text-foreground" onClick={() => c.citar(null)}>
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
            {c.sugerindo && c.citado ? (
              <>
                <textarea
                  ref={campo}
                  aria-label="Texto novo do trecho"
                  placeholder="Texto novo do trecho (vazio apaga)"
                  value={textoNovo}
                  maxLength={SUGESTAO_MAX}
                  rows={3}
                  onChange={(e) => c.escreverRascunho("sugestao", e.target.value)}
                  className="w-full resize-y rounded-lg border border-input bg-input/20 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
                />
                {sugestaoMudou ? <DiffSugestao antes={c.citado.trecho} depois={textoNovo.trim()} /> : null}
              </>
            ) : null}
            <CampoTexto valor={texto} mudar={setTexto} rotulo={c.sugerindo ? "Por que mudar (opcional)" : c.citado ? "Comentário sobre o trecho" : c.campoCitado ? "Comentário sobre o dado" : "Comentário geral"} campo={c.sugerindo ? undefined : campo} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="xs" disabled={ocupado || !podeEnviar}>
                {c.sugerindo ? "Sugerir agora" : "Comentar agora"}
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={ocupado || !podeEnviar} onClick={() => enviar(true)}>
                Adicionar à revisão
              </Button>
              {podeSugerir && !c.sugerindo ? (
                <Button type="button" size="xs" variant="ghost" onClick={() => c.citar(c.citado, { sugerir: true })}>
                  <PencilLine className="size-3" /> Sugerir texto
                </Button>
              ) : null}
              {alinhar ? (
                <Button type="button" size="xs" variant="ghost" onClick={fechar}>
                  Cancelar
                </Button>
              ) : !c.citado && !c.campoCitado ? (
                <span className="text-[11px] text-fg-faint">Para citar um trecho: selecione no texto.</span>
              ) : null}
            </div>
          </form>
        ) : null}

        {erro ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {erro}
          </p>
        ) : null}
        {c.erroCarga ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {c.erroCarga}
          </p>
        ) : null}
      </div>

      {visiveis.length ? (
        <ul ref={lista} className={cn("mt-4", posicoes ? "relative" : "space-y-3")} style={posicoes ? { height: posicoes.altura } : undefined}>
          {visiveis.map((t) => (
            <Thread key={t.id} t={t} topo={posicoes?.topos[t.id]} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-fg-faint">{c.threads.length ? "Nenhum comentário aberto." : "Nenhum comentário ainda."}</p>
      )}
    </section>
  );
}

function topoDoTrecho(id: string): number {
  return document.querySelector(`[data-comentario="${CSS.escape(id)}"]`)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
}
