"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redefinirSenhaAction } from "@/lib/auth/actions";

export function RedefinirForm({ token }: { token: string }) {
  const [estado, action, pendente] = useActionState(redefinirSenhaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="senha">Nova senha (mín. 8 caracteres)</Label>
        <Input id="senha" name="senha" type="password" autoComplete="new-password" minLength={8} required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmacao">Confirmar nova senha</Label>
        <Input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </form>
  );
}
