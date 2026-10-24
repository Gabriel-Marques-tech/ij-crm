"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronsLeftRight, Plus } from "lucide-react";
import { cn } from "cn";
import { ConfirmarTerminal, type PedidoTerminal } from "@/components/kanban/confirmar-terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarCardAction, moverCardAction } from "./actions";
import { CardVisual } from "./card-visual";
import { desfazerMovimento } from "./otimista";
import type { CardCliente, FaseCliente } from "./tipos";

type Props = { pipelineId: string; fases: FaseCliente[]; cards: CardCliente[]; agoraMs: number };

const idColuna = (faseId: string) => `fase:${faseId}`;

export function QuadroKanban({ pipelineId, fases, cards: cardsServidor, agoraMs }: Props) {
  // Estado otimista: parte do servidor e é re-sincronizado quando chegam props novas (revalidate).
  const [base, setBase] = useState(cardsServidor);
  const [cards, setCards] = useState(cardsServidor);
  if (base !== cardsServidor) {
    setBase(cardsServidor);
    setCards(cardsServidor);
  }

  const [ativo, setAtivo] = useState<CardCliente | null>(null);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [pedido, setPedido] = useState<(PedidoTerminal & { cardId: string; faseId: string }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Toque: segurar 200ms para arrastar; deslizar rápido continua rolando o quadro.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const faseDe = (id: string) => fases.find((f) => f.id === id);
  const faseDoAlvo = (overId: string | number | undefined): string | null => {
    if (overId === undefined) return null;
    const s = String(overId);
    if (s.startsWith("fase:")) return s.slice(5);
    return cards.find((c) => c.id === s)?.faseId ?? null;
  };

  function mover(cardId: string, paraFaseId: string) {
    const original = cards.find((c) => c.id === cardId);
    if (!original || original.faseId === paraFaseId) return;
    setErro(null);
    // Otimista: vai para o topo da coluna destino, zerando os dias na fase.
    setCards((cs) => [{ ...original, faseId: paraFaseId, faseDesdeMs: Date.now() }, ...cs.filter((c) => c.id !== cardId)]);
    startTransition(async () => {
      let r: { erro?: string };
      try {
        r = await moverCardAction(cardId, paraFaseId);
      } catch {
        r = { erro: "Falha de rede ao mover o card." };
      }
      if (r.erro) {
        // Reconcilia com o estado ATUAL (outros movimentos podem ter acontecido
        // nesse meio-tempo): desfaz só este movimento, e só se o card ainda está
        // onde o otimista o pôs. Depois busca a verdade no servidor.
        setCards((cs) => desfazerMovimento(cs, cardId, paraFaseId, original));
        setErro(r.erro);
        router.refresh();
      }
    });
  }

  function aoSoltar(cardId: string, paraFaseId: string) {
    const card = cards.find((c) => c.id === cardId);
    const destino = faseDe(paraFaseId);
    if (!card || !destino || card.faseId === paraFaseId) return;
    if (destino.isTerminal) {
      setPedido({ cardId, faseId: paraFaseId, titulo: card.titulo, faseNome: destino.nome, tipo: destino.tipoTerminal });
      return;
    }
    mover(cardId, paraFaseId);
  }

  function onDragStart(e: DragStartEvent) {
    setAtivo(cards.find((c) => c.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setAtivo(null);
    const para = faseDoAlvo(e.over?.id);
    if (para) aoSoltar(String(e.active.id), para);
  }

  const nomeAlvo = (overId: string | number | undefined) => {
    const f = faseDoAlvo(overId);
    return f ? (faseDe(f)?.nome ?? "fase") : null;
  };
  const tituloDe = (id: string | number) => cards.find((c) => c.id === id)?.titulo ?? "card";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pegou o card ${tituloDe(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${tituloDe(active.id)} sobre ${nomeAlvo(over.id)}.` : `${tituloDe(active.id)} fora das colunas.`),
    onDragEnd: ({ active, over }) => (over ? `${tituloDe(active.id)} solto em ${nomeAlvo(over.id)}.` : `${tituloDe(active.id)} solto fora; nada mudou.`),
    onDragCancel: ({ active }) => `Movimento de ${tituloDe(active.id)} cancelado.`,
  };

  return (
    <>
      {erro ? (
        <p role="alert" className="mb-4 rounded-lg border border-danger/50 bg-surface px-3 py-2 text-sm text-fg-soft">
          {erro}
        </p>
      ) : null}
      <DndContext
        id={`kanban-${pipelineId}`}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setAtivo(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Para mover, pressione espaço ou enter, use as setas para escolher a fase e pressione espaço ou enter de novo. Esc cancela.",
          },
        }}
      >
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
          {fases.map((f) => {
            const daFase = cards.filter((c) => c.faseId === f.id);
            const colapsada = f.isTerminal && !expandidas.has(f.id);
            const alternar = () =>
              setExpandidas((s) => {
                const n = new Set(s);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              });
            return colapsada ? (
              <ColunaColapsada key={f.id} fase={f} total={daFase.length} onExpandir={alternar} />
            ) : (
              <Coluna key={f.id} fase={f} cards={daFase} agoraMs={agoraMs} pipelineId={pipelineId} onRecolher={f.isTerminal ? alternar : undefined} />
            );
          })}
        </div>
        <DragOverlay>{ativo ? <CardVisual card={ativo} fase={faseDe(ativo.faseId)} agoraMs={agoraMs} arrastando /> : null}</DragOverlay>
      </DndContext>
      <ConfirmarTerminal
        pedido={pedido}
        onCancelar={() => setPedido(null)}
        onConfirmar={() => {
          if (pedido) mover(pedido.cardId, pedido.faseId);
          setPedido(null);
        }}
      />
    </>
  );
}

function CorDaFase({ cor }: { cor: string | null }) {
  // Cor da fase é dado de domínio (escolhido pelo gestor), por isso inline.
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-fg-faint" style={cor ? { backgroundColor: cor } : undefined} />;
}

function Coluna({
  fase,
  cards,
  agoraMs,
  pipelineId,
  onRecolher,
}: {
  fase: FaseCliente;
  cards: CardCliente[];
  agoraMs: number;
  pipelineId: string;
  onRecolher?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: idColuna(fase.id) });
  const [criando, setCriando] = useState(false);

  return (
    <section
      aria-label={`Fase ${fase.nome}, ${cards.length} card(s)`}
      className={cn(
        "flex w-[85vw] max-w-72 shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/60 sm:w-72",
        isOver && "border-border-strong bg-surface/40",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <CorDaFase cor={fase.cor} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{fase.nome}</h2>
        <span className="font-mono text-xs text-fg-faint tabular">{cards.length}</span>
        {onRecolher ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Recolher ${fase.nome}`} title="Recolher" onClick={onRecolher}>
            <ChevronsLeftRight />
          </Button>
        ) : null}
        {/* Terminal não recebe card novo: ganho/perdido só por movimento (gancho GAB-32). */}
        {!fase.isTerminal ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Novo card em ${fase.nome}`} title="Novo card" onClick={() => setCriando(true)}>
            <Plus />
          </Button>
        ) : null}
      </header>
      {fase.limiteDiasAlerta !== null ? <p className="-mt-1 px-3 pb-2 font-mono text-[10px] text-fg-faint">alerta ≥ {fase.limiteDiasAlerta}d</p> : null}

      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {criando ? <NovoCard pipelineId={pipelineId} faseId={fase.id} onFim={() => setCriando(false)} /> : null}
        <SortableContext id={idColuna(fase.id)} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <CardArrastavel key={c.id} card={c} fase={fase} agoraMs={agoraMs} />
          ))}
        </SortableContext>
        {cards.length === 0 && !criando ? <p className="px-2 py-6 text-center text-xs text-fg-faint">Solte um card aqui</p> : null}
      </div>
    </section>
  );
}

/** Terminal recolhida: faixa estreita, ainda aceita drop. */
function ColunaColapsada({ fase, total, onExpandir }: { fase: FaseCliente; total: number; onExpandir: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: idColuna(fase.id) });
  return (
    <section
      ref={setNodeRef}
      aria-label={`Fase ${fase.nome} (recolhida), ${total} card(s)`}
      className={cn(
        "flex w-12 shrink-0 snap-start flex-col items-center rounded-xl border border-dashed border-border bg-muted/40 py-3",
        isOver && "border-solid border-border-strong bg-surface/40",
      )}
    >
      <button
        type="button"
        onClick={onExpandir}
        aria-label={`Expandir ${fase.nome}`}
        title={`Expandir ${fase.nome}`}
        className="flex flex-1 flex-col items-center gap-2 rounded-md px-1 text-fg-mute outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CorDaFase cor={fase.cor} />
        <span className="font-mono text-xs tabular">{total}</span>
        <span className="text-xs whitespace-nowrap [writing-mode:vertical-rl]">{fase.nome}</span>
      </button>
    </section>
  );
}

function CardArrastavel({ card, fase, agoraMs }: { card: CardCliente; fase: FaseCliente; agoraMs: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { faseId: card.faseId },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-40")}
      {...attributes}
      aria-roledescription="card arrastável"
      aria-label={`${card.titulo}. Pressione espaço para mover.`}
      {...listeners}
    >
      <CardVisual card={card} fase={fase} agoraMs={agoraMs} />
    </div>
  );
}

function NovoCard({ pipelineId, faseId, onFim }: { pipelineId: string; faseId: string; onFim: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return onFim();
    setErro(null);
    startTransition(async () => {
      let r: { erro?: string };
      try {
        r = await criarCardAction(pipelineId, faseId, titulo);
      } catch {
        r = { erro: "Falha de rede ao criar o card. Tente de novo." };
      }
      if (r.erro) setErro(r.erro);
      else {
        setTitulo("");
        onFim();
      }
    });
  }

  return (
    <form onSubmit={enviar} className="rounded-lg border border-border-strong bg-surface p-2">
      <Input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onFim()}
        placeholder="Nome do contato ou empresa"
        aria-label="Título do novo card"
        maxLength={200}
        disabled={pendente}
      />
      {erro ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {erro}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={onFim}>
          Cancelar
        </Button>
        <Button type="submit" size="xs" disabled={pendente}>
          Criar
        </Button>
      </div>
    </form>
  );
}
