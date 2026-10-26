"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pedirRedefinicaoAction } from "@/lib/auth/actions";

/** Mesma resposta para qualquer email (sem enumeração de contas). */
const RESPOSTA = "Se o email existir, um gestor vai receber o pedido e te mandar um link para criar uma nova senha.";

export function EsqueciForm() {
  const [estado, action, pendente] = useActionState(pedirRedefinicaoAction, undefined);
  if (estado?.enviado) {
    return (
      <p role="status" className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-soft">
        {RESPOSTA}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Enviando…" : "Pedir nova senha"}
      </Button>
    </form>
  );
}
