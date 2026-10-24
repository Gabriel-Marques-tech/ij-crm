"use client";

import { useActionState, useState } from "react";
import type { Papel } from "@prisma/client";
import { Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarConviteAction } from "./actions";
import { SelectPapel } from "./select-papel";

export function ConvidarDialog({ papelAtor }: { papelAtor: Papel }) {
  const [aberto, setAberto] = useState(false);
  const [estado, action, pendente] = useActionState(criarConviteAction, undefined);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4" />
        Convidar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>Você recebe um link para mandar por WhatsApp ou email. Vale 7 dias.</DialogDescription>
        </DialogHeader>

        {estado?.link ? (
          <LinkGerado link={estado.link} expiraEm={estado.expiraEm} onFechar={() => setAberto(false)} />
        ) : (
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" name="nome" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telefone">WhatsApp (DDD + número)</Label>
              <Input id="telefone" name="telefone" placeholder="11 99999-8888" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="papel">Papel</Label>
              <SelectPapel name="papel" papelAtor={papelAtor} defaultValue="VENDEDOR" />
            </div>
            {estado?.erro ? (
              <p role="alert" className="text-sm text-danger">
                {estado.erro}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pendente}>
              {pendente ? "Gerando…" : "Gerar link de convite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LinkGerado({ link, expiraEm, onFechar }: { link: string; expiraEm?: string; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    await navigator.clipboard.writeText(link);
    setCopiado(true);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="eyebrow mb-1">link do convite</p>
        <p className="break-all font-mono text-xs text-fg-soft">{link}</p>
      </div>
      {expiraEm ? (
        <p className="text-xs text-fg-faint">
          Expira em{" "}
          <span className="font-mono">
            {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(expiraEm))}
          </span>
          . Mostrado só uma vez — se perder, reemita.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={copiar} className="flex-1">
          <Copy className="h-4 w-4" />
          {copiado ? "Copiado" : "Copiar link"}
        </Button>
        <Button variant="outline" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
