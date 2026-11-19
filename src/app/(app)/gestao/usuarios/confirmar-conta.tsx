"use client";

import { Button } from "@/components/ui/button";
import type { ContaAConfirmar } from "@/lib/auth/cadastro";

/**
 * GAB-107 (revisão): a conta que vai ser gravada não é a que a tela mostrava (ficha ligada com outras
 * posições no cadastro) ou a posição muda o papel (edição). Mostra o resultado e as posições que levam
 * a ele; só segue com o clique explícito, que manda de volta exatamente este resultado.
 */
export function ConfirmarConta({
  pedido,
  pendente,
  onConfirmar,
  onCancelar,
  rotuloAtual = "A tela mostrava",
}: {
  pedido: ContaAConfirmar;
  pendente: boolean;
  onConfirmar: () => void;
  onCancelar?: () => void;
  rotuloAtual?: string;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-warn/50 bg-muted p-3 text-sm">
      <p>
        A conta no CRM vai ficar <strong>{pedido.conta}</strong>.
      </p>
      <p className="text-xs text-fg-soft">
        {rotuloAtual}: {pedido.atual}.{" "}
        {pedido.posicoes.length ? <>Por causa das posições: {pedido.posicoes.join(", ")}.</> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pendente} onClick={onConfirmar}>
          Confirmar: {pedido.conta}
        </Button>
        {onCancelar ? (
          <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={onCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
