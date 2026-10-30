"use client";

import { useState, useTransition } from "react";
import { DialogoTerminal, type PedidoTerminal } from "@/components/kanban/dialogo-terminal";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { dialogoTerminal, type DadosTerminal } from "@/lib/projetos/terminal-regras";
import { moverCardAction } from "../../kanban/actions";
import type { FaseCliente } from "../../kanban/tipos";

/** Mover de fase pelo detalhe (alternativa ao arrasto, boa no celular). Mesmos diálogos de ganho/perdido do quadro. */
export function MoverFase({
  cardId,
  titulo,
  faseAtualId,
  fases,
  pipelineChave,
  fechamento,
  somenteLeitura = false,
}: {
  cardId: string;
  titulo: string;
  faseAtualId: string;
  fases: FaseCliente[];
  pipelineChave: string;
  /** Último fechamento guardado: pré-preenche o diálogo. */
  fechamento: { valorFechado: string | null; motivoPerda: string | null };
  /** VISUALIZADOR: select travado (o servidor recusa o movimento de qualquer jeito). */
  somenteLeitura?: boolean;
}) {
  const [pedido, setPedido] = useState<(PedidoTerminal & { faseId: string }) | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function mover(faseId: string, dados?: DadosTerminal) {
    setErro(null);
    startTransition(async () => {
      setErro(await executarAcao(() => moverCardAction(cardId, faseId, dados), "mover o card"));
    });
  }

  function escolher(faseId: string) {
    const f = fases.find((x) => x.id === faseId);
    if (!f || f.id === faseAtualId) return;
    const tipo = dialogoTerminal(pipelineChave, f.tipoTerminal);
    if (tipo) setPedido({ faseId, titulo, faseNome: f.nome, tipo, inicial: fechamento });
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
        disabled={pendente || somenteLeitura}
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
      <DialogoTerminal
        pedido={pedido}
        onCancelar={() => setPedido(null)}
        onConfirmar={(dados) => {
          if (pedido) mover(pedido.faseId, dados);
          setPedido(null);
        }}
      />
    </div>
  );
}
