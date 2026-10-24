"use client";

import { useState, useTransition } from "react";
import { ConfirmarTerminal, type PedidoTerminal } from "@/components/kanban/confirmar-terminal";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { moverCardAction } from "../actions";
import type { FaseCliente } from "../tipos";

/** Mover de fase pelo detalhe (alternativa ao arrasto, boa no celular). */
export function MoverFase({ cardId, titulo, faseAtualId, fases }: { cardId: string; titulo: string; faseAtualId: string; fases: FaseCliente[] }) {
  const [pedido, setPedido] = useState<(PedidoTerminal & { faseId: string }) | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function mover(faseId: string) {
    setErro(null);
    startTransition(async () => {
      setErro(await executarAcao(() => moverCardAction(cardId, faseId), "mover o card"));
    });
  }

  function escolher(faseId: string) {
    const f = fases.find((x) => x.id === faseId);
    if (!f || f.id === faseAtualId) return;
    if (f.isTerminal) setPedido({ faseId, titulo, faseNome: f.nome, tipo: f.tipoTerminal });
    else mover(faseId);
  }

  return (
    <div>
      <label htmlFor="mover-fase" className="eyebrow mb-1 block">
        Fase
      </label>
      <select
        id="mover-fase"
        value={faseAtualId}
        disabled={pendente}
        onChange={(e) => escolher(e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {fases.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
            {f.tipoTerminal === "GANHO" ? " (ganho)" : f.tipoTerminal === "PERDIDO" ? " (perdido)" : ""}
          </option>
        ))}
      </select>
      <MensagemErro falha={erro} className="mt-1" />
      <ConfirmarTerminal
        pedido={pedido}
        onCancelar={() => setPedido(null)}
        onConfirmar={() => {
          if (pedido) mover(pedido.faseId);
          setPedido(null);
        }}
      />
    </div>
  );
}
