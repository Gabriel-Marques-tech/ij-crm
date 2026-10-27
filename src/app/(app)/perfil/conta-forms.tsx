"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarPaginaInicialAction, trocarEmailAction, trocarSenhaAction, type EstadoPerfil } from "./actions";

function Retorno({ estado, ok }: { estado: EstadoPerfil; ok: string }) {
  if (estado?.erro)
    return (
      <p role="alert" className="text-sm text-danger">
        {estado.erro}
      </p>
    );
  if (estado?.ok) return <p className="text-sm text-success">{ok}</p>;
  return null;
}

export function SenhaForm() {
  const [estado, action, pendente] = useActionState(trocarSenhaAction, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-surface p-5" key={estado?.ok ? "ok" : "form"}>
      <h2 className="text-sm font-medium">Trocar senha</h2>
      <div className="space-y-1.5">
        <Label htmlFor="senha-atual">Senha atual</Label>
        <Input id="senha-atual" name="atual" type="password" autoComplete="current-password" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha-nova">Nova senha (mín. 8 caracteres)</Label>
        <Input id="senha-nova" name="nova" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha-confirmacao">Confirmar nova senha</Label>
        <Input id="senha-confirmacao" name="confirmacao" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <p className="text-xs text-fg-faint">Ao trocar, todas as suas outras sessões são encerradas; esta continua aberta.</p>
      <Retorno estado={estado} ok="Senha trocada. As outras sessões foram encerradas." />
      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando…" : "Trocar senha"}
      </Button>
    </form>
  );
}

export function EmailForm({ email }: { email: string }) {
  const [estado, action, pendente] = useActionState(trocarEmailAction, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">Trocar email</h2>
      <div className="space-y-1.5">
        <Label htmlFor="email-novo">Novo email</Label>
        <Input id="email-novo" name="email" type="email" autoComplete="email" defaultValue={email} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email-senha">Sua senha (para confirmar)</Label>
        <Input id="email-senha" name="senha" type="password" autoComplete="current-password" required />
      </div>
      <Retorno estado={estado} ok="Email atualizado. Use o novo email para entrar." />
      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando…" : "Trocar email"}
      </Button>
    </form>
  );
}

const OPCOES = [
  { valor: "semana", rotulo: "Minha Semana" },
  { valor: "vendas", rotulo: "Kanban · Vendas" },
  { valor: "projetos", rotulo: "Kanban · Projetos" },
] as const;

export function PaginaInicialForm({ atual }: { atual: (typeof OPCOES)[number]["valor"] }) {
  const [estado, action, pendente] = useActionState(salvarPaginaInicialAction, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">Página inicial</h2>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-fg-faint">O que abre quando você entra no CRM. Minha Semana continua no menu.</legend>
        {OPCOES.map((o) => (
          <label key={o.valor} className="flex items-center gap-2 text-sm">
            <input type="radio" name="inicio" value={o.valor} defaultChecked={o.valor === atual} className="accent-primary" />
            {o.rotulo}
          </label>
        ))}
      </fieldset>
      <Retorno estado={estado} ok="Salvo." />
      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
