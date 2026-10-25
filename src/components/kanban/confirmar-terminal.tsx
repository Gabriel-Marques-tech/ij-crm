"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PedidoTerminal = { titulo: string; faseNome: string; tipo: "GANHO" | "PERDIDO" | null };

/**
 * Confirmação antes de mover para fase terminal. GAB-32 estende este diálogo
 * para pedir `valor_fechado` (ganho) / `motivo_perda` (perdido) e repassa os
 * dados a `moverCard(..., { dadosTerminal })` → `aoEntrarEmTerminal`.
 */
export function ConfirmarTerminal({
  pedido,
  onConfirmar,
  onCancelar,
}: {
  pedido: PedidoTerminal | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const tipo = pedido?.tipo === "GANHO" ? "de ganho" : pedido?.tipo === "PERDIDO" ? "de perdido" : "terminal";
  return (
    <Dialog open={pedido !== null} onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para {pedido?.faseNome}?</DialogTitle>
          <DialogDescription>
            “{pedido?.titulo}” vai para uma fase {tipo}. Dá para mover de volta depois.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} autoFocus>
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
