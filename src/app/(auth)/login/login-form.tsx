"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/lib/auth/actions";

/** `voltar`: caminho interno para depois do login (já validado pela página). */
export function LoginForm({ voltar, autoFocus = true }: { voltar?: string | null; autoFocus?: boolean }) {
  const [estado, action, pendente] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {voltar ? <input type="hidden" name="voltar" value={voltar} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus={autoFocus} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" name="senha" type="password" autoComplete="current-password" required />
      </div>
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
