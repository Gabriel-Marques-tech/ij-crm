"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MessageSquare, PanelRight } from "lucide-react";
import { Folha, type DadosCapa } from "@/components/propostas/folha";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Documento } from "@/lib/propostas/documento";
import type { Estruturado } from "@/lib/propostas/estruturado";
import { ComentarNaFolha } from "./comentar-na-folha";
import { BotaoComentarTrecho, TextoComentavel, useComentarios } from "./comentarios-contexto";
import { PainelComentarios } from "./painel-comentarios";

const CONSULTA_LARGA = "(min-width: 1024px)";

function assinarLargura(avisar: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const m = window.matchMedia(CONSULTA_LARGA);
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}

/** Uma árvore só, em cada largura: montar as duas duplicaria ids de comentário e o estado do formulário. */
function useTelaLarga(): boolean {
  return useSyncExternalStore(
    assinarLargura,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA_LARGA).matches : true),
    () => true,
  );
}

/**
 * As três colunas da proposta (GAB-100, spec proposta-folha §3): comentários na margem,
 * folha no centro, ações e infos à direita. Abaixo de 1024 px a folha ocupa a largura, e
 * comentários e infos abrem em painel.
 */
export function GradeFolha({ centro, direita }: { centro: ReactNode; direita: ReactNode }) {
  const larga = useTelaLarga();
  const c = useComentarios();
  const titulo = useRef<HTMLHeadingElement>(null);
  const [painel, setPainel] = useState<"comentarios" | "infos" | null>(null);
  // Citou um trecho ou tocou num destacado, no celular: o comentário está no painel.
  const pedido = (c?.pedidoFoco ?? 0) + (c?.pedidoPainel ?? 0);
  const [pedidoVisto, setPedidoVisto] = useState(pedido);
  if (pedido !== pedidoVisto) {
    setPedidoVisto(pedido);
    if (!larga) setPainel("comentarios");
  }

  // `centro` fica sempre no mesmo lugar da árvore: cruzar os 1024 px (girar o tablet, redimensionar a
  // janela) não pode remontar o editor, que voltaria ao texto da abertura e o gravaria por cima.
  const abertos = c?.threads.filter((t) => !t.resolvido && !t.pendente).length ?? 0;
  return (
    <div className="grade-proposta">
      {larga ? (
        <div className="flex min-w-0 flex-col">{c ? <PainelComentarios alinhar /> : null}</div>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-2">
          {c ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setPainel("comentarios")}>
              <MessageSquare className="size-3.5" /> Comentários ({abertos}){c.pendentes ? ` · revisão (${c.pendentes})` : ""}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setPainel("infos")}>
            <PanelRight className="size-3.5" /> Ações e informações
          </Button>
        </div>
      )}
      <ComentarNaFolha larga={larga}>{centro}</ComentarNaFolha>
      {larga ? (
        <aside className="grade-proposta-direita min-w-0 space-y-3">{direita}</aside>
      ) : (
        <Sheet open={painel !== null} onOpenChange={(aberto) => !aberto && setPainel(null)}>
          <SheetContent side="right" initialFocus={titulo} className="w-[min(92vw,24rem)] overflow-y-auto sm:max-w-none">
            <SheetHeader>
              {/* Foco no título: abrir o painel no celular não abre o teclado. */}
              <SheetTitle ref={titulo} tabIndex={-1} className="outline-none">{painel === "comentarios" ? "Comentários" : "Ações e informações"}</SheetTitle>
            </SheetHeader>
            <div className="space-y-3 px-4 pb-6">{painel === "comentarios" ? <PainelComentarios /> : direita}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** A mesma tela para quem não tem a caneta: sem barra de formatação, comentando. */
export function LeituraFolha({ documento, dados, capa, direita }: { documento: Documento; dados: Estruturado; capa?: DadosCapa; direita: ReactNode }) {
  return (
    <GradeFolha
      direita={direita}
      centro={
        <div className="min-w-0 space-y-2.5">
          <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-surface p-1 pl-2">
            <span className="font-mono text-[11px] text-fg-faint">somente leitura</span>
            <span className="flex-1" />
            <BotaoComentarTrecho />
          </div>
          {capa ? (
            <Folha capa={capa} recolhivel>
              <TextoComentavel documento={documento} dados={dados} />
            </Folha>
          ) : (
            <TextoComentavel documento={documento} dados={dados} />
          )}
        </div>
      }
    />
  );
}
