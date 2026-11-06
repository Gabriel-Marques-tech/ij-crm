"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare, PencilLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Ancora } from "@/lib/propostas/ancora";
import { trechoSugerivel } from "@/lib/propostas/sugestao-trecho";
import { useComentarios } from "./comentarios-contexto";

/** Blocos da folha que recebem o "+". O `p` de dentro de um item de lista é o texto dele. */
const BLOCOS = "p, h1, h2, h3, li";
const ATRASO_SELECAO_MS = 120;
const ALTURA_BALAO = 40;
const TOPO_LIVRE = 64;

function elementoDoBloco(alvo: Element): Element | null {
  // O bloco de dados vem antes: o título e a tabela dele não são texto do documento.
  const el = alvo.closest("[data-bloco]") ?? alvo.closest(BLOCOS);
  if (!el || !el.closest(".proposta-texto")) return null;
  return el.matches("li") ? (el.querySelector(":scope > p") ?? el) : el;
}

/**
 * "+" ao lado da linha e balão da seleção (GAB-101). Só leem a folha e citam o trecho no formulário
 * de comentário: nada entra no documento nem tira o foco do editor (`mousedown` não muda a seleção).
 */
export function ComentarNaFolha({ larga, children }: { larga: boolean; children: ReactNode }) {
  const c = useComentarios();
  const raiz = useRef<HTMLDivElement>(null);
  const blocoAtual = useRef<Element | null>(null);
  const [mais, setMais] = useState<{ topo: number; esquerda: number } | null>(null);

  const esconderMais = () => {
    blocoAtual.current = null;
    setMais(null);
  };

  // Digitando, o "+" sai da frente até o mouse andar de novo.
  useEffect(() => {
    if (!c) return;
    const tecla = () => {
      blocoAtual.current = null;
      setMais(null);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [c]);

  function aoMover(e: React.MouseEvent) {
    if (!c) return;
    const alvo = e.target as Element;
    if (alvo.closest("[data-botao-linha]")) return;
    if (!alvo.closest("[data-folha]")) return esconderMais();
    const bloco = elementoDoBloco(alvo);
    // Entre um bloco e o "+" (o vão da margem): o "+" fica.
    if (!bloco || bloco === blocoAtual.current) return;
    if (!c.ancoraDoElemento(bloco)) return esconderMais();
    const base = raiz.current?.getBoundingClientRect();
    const texto = bloco.closest(".proposta-texto")?.getBoundingClientRect();
    if (!base || !texto) return;
    blocoAtual.current = bloco;
    setMais({ topo: bloco.getBoundingClientRect().top - base.top, esquerda: texto.left - base.left - 30 });
  }

  return (
    <div ref={raiz} className="relative min-w-0" onMouseMove={c ? aoMover : undefined} onMouseLeave={c ? esconderMais : undefined}>
      {children}
      {c && mais ? (
        <button
          type="button"
          data-botao-linha
          aria-label="Comentar esta linha"
          title="Comentar esta linha"
          style={{ top: mais.topo, left: mais.esquerda }}
          className="botao-linha absolute z-[3] size-6 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-soft shadow-sm hover:bg-surface-hover hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const a = blocoAtual.current ? c.ancoraDoElemento(blocoAtual.current) : null;
            if (a) c.citar(a);
          }}
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
      {c ? <BalaoSelecao larga={larga} /> : null}
    </div>
  );
}

type Balao = { ancora: Ancora; topo: number; esquerda: number };

/**
 * Selecionou um trecho da folha: "Comentar" e "Sugerir". Acima da seleção, para não cobrir o que se
 * está lendo; some ao digitar ou com Esc, e não aparece durante o arraste. Em tela estreita fica numa
 * barra no rodapé: nunca sobre o texto, nem brigando com o menu de seleção do celular.
 */
function BalaoSelecao({ larga }: { larga: boolean }) {
  const c = useComentarios();
  const [balao, setBalao] = useState<Balao | null>(null);
  const lerSelecao = c?.lerSelecao;
  const citar = c?.citar;

  useEffect(() => {
    if (!lerSelecao) return;
    let arrastando = false;
    let atraso: ReturnType<typeof setTimeout> | undefined;
    let quadro = 0;
    let visivel = false;
    const mostrar = (b: Balao | null) => {
      visivel = b !== null;
      setBalao(b);
    };
    const atualizar = () => {
      const sel = window.getSelection();
      if (arrastando || !sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.anchorNode) return mostrar(null);
      const no = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
      if (!no?.closest("[data-folha]")) return mostrar(null);
      const ancora = lerSelecao();
      if (!ancora) return mostrar(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const topo = r.top - ALTURA_BALAO - 6 < TOPO_LIVRE ? r.bottom + 6 : r.top - ALTURA_BALAO - 6;
      mostrar({ ancora, topo, esquerda: r.left + r.width / 2 });
    };
    const agendar = () => {
      clearTimeout(atraso);
      atraso = setTimeout(atualizar, ATRASO_SELECAO_MS);
    };
    const baixar = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-balao-selecao]")) return;
      arrastando = e.pointerType === "mouse";
      if (arrastando) mostrar(null);
    };
    const soltar = () => {
      arrastando = false;
      agendar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || !e.shiftKey) mostrar(null);
    };
    const rolar = () => {
      if (!visivel) return;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(atualizar);
    };
    document.addEventListener("selectionchange", agendar);
    document.addEventListener("pointerdown", baixar);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", soltar);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", rolar, { capture: true, passive: true });
    return () => {
      clearTimeout(atraso);
      cancelAnimationFrame(quadro);
      document.removeEventListener("selectionchange", agendar);
      document.removeEventListener("pointerdown", baixar);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", soltar);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", rolar, { capture: true });
    };
  }, [lerSelecao]);

  if (!balao || !citar) return null;
  const pode = trechoSugerivel(balao.ancora.trecho);
  const acionar = (sugerir: boolean) => {
    citar(balao.ancora, { sugerir });
    setBalao(null);
  };
  return (
    <div
      role="toolbar"
      aria-label="Comentar a seleção"
      data-balao-selecao
      style={larga ? { position: "fixed", top: balao.topo, left: `clamp(100px, ${balao.esquerda}px, calc(100vw - 100px))`, transform: "translateX(-50%)" } : undefined}
      className={larga ? "z-[6] flex gap-1 rounded-lg border border-border-strong bg-surface-strong p-1 shadow-lg" : "fixed inset-x-3 bottom-[4.5rem] z-30 flex justify-center md:bottom-3 gap-2 rounded-lg border border-border-strong bg-surface-strong p-1.5 shadow-lg"}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button type="button" size="xs" variant="ghost" onClick={() => acionar(false)}>
        <MessageSquare className="size-3" /> Comentar
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={!pode} title={pode ? "Propor o texto novo deste trecho" : "Sugestão só vale dentro de um mesmo bloco de texto"} onClick={() => acionar(true)}>
        <PencilLine className="size-3" /> Sugerir
      </Button>
    </div>
  );
}
