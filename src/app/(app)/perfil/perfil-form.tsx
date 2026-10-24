"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { editarMeuPerfilAction } from "./actions";

export function PerfilForm({ nome, telefone }: { nome: string; telefone: string }) {
  const [estado, action, pendente] = useActionState(editarMeuPerfilAction, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" defaultValue={nome} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="telefone">WhatsApp (DDD + número)</Label>
        <Input id="telefone" name="telefone" defaultValue={telefone} placeholder="11 99999-8888" inputMode="tel" />
        <p className="text-xs text-fg-faint">Use o número com que você manda mensagem no grupo de vendas.</p>
      </div>
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      {estado?.ok ? <p className="text-sm text-success">Salvo.</p> : null}
      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
