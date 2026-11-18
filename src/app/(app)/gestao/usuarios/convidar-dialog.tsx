"use client";

import { useActionState, useRef, useState } from "react";
import type { Papel } from "@prisma/client";
import { Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarConviteAction } from "./actions";
import { CamposPapelLado } from "./campos-lado";

export function ConvidarDialog({ papelAtor, googleAtivo = false }: { papelAtor: Papel; googleAtivo?: boolean }) {
  const [aberto, setAberto] = useState(false);
  // Remonta o corpo a cada abertura: o estado do useActionState (link gerado,
  // erro) não vaza para o próximo convite.
  const [iteracao, setIteracao] = useState(0);

  function mudarAberto(v: boolean) {
    setAberto(v);
    if (!v) setIteracao((i) => i + 1);
  }

  return (
    <Dialog open={aberto} onOpenChange={mudarAberto}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4" />
        {googleAtivo ? "Cadastrar" : "Convidar"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{googleAtivo ? "Cadastrar pessoa" : "Convidar pessoa"}</DialogTitle>
          <DialogDescription>
            {googleAtivo
              ? "Depois de salvar, a pessoa já entra com a conta Google deste email. Não precisa mandar link."
              : "Você recebe um link para mandar por WhatsApp ou email. Vale 7 dias."}
          </DialogDescription>
        </DialogHeader>
        <CorpoConvite key={iteracao} papelAtor={papelAtor} googleAtivo={googleAtivo} onFechar={() => mudarAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CorpoConvite({ papelAtor, googleAtivo, onFechar }: { papelAtor: Papel; googleAtivo: boolean; onFechar: () => void }) {
  const [estado, action, pendente] = useActionState(criarConviteAction, undefined);

  if (estado?.link && googleAtivo) return <CadastroComGoogle email={estado.email} link={estado.link} expiraEm={estado.expiraEm} onFechar={onFechar} />;
  if (estado?.link) return <LinkGerado link={estado.link} expiraEm={estado.expiraEm} onFechar={onFechar} />;

  return (
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
      <CamposPapelLado papelAtor={papelAtor} papel="VENDEDOR" area={null} cargos={[]} />
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Salvando…" : googleAtivo ? "Cadastrar" : "Gerar link de convite"}
      </Button>
    </form>
  );
}

/** Com o Google configurado: a pessoa já pode entrar; o link de convite (senha) fica opcional. */
function CadastroComGoogle({ email, link, expiraEm, onFechar }: { email?: string; link: string; expiraEm?: string; onFechar: () => void }) {
  const [mostrarLink, setMostrarLink] = useState(false);
  if (mostrarLink) return <LinkGerado link={link} expiraEm={expiraEm} onFechar={onFechar} aviso="Mostrado só uma vez. Deixa de valer depois do primeiro login com Google." />;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-3 text-sm">
        <p className="eyebrow mb-1">cadastrado</p>
        <p>
          {email ? <span className="font-mono text-fg-soft">{email}</span> : "A pessoa"} já pode entrar no CRM com <strong>Entrar com Google</strong>. Não precisa mandar link.
        </p>
      </div>
      <p className="text-xs text-fg-faint">
        Prefere que ela use senha? Mostre o link de convite (vale 7 dias, aparece uma vez só). Ele deixa de valer depois do primeiro login com Google.
      </p>
      <div className="flex gap-2">
        <Button onClick={onFechar} className="flex-1">
          Fechar
        </Button>
        <Button variant="outline" onClick={() => setMostrarLink(true)}>
          Mostrar link de convite
        </Button>
      </div>
    </div>
  );
}

export function LinkGerado({
  link,
  expiraEm,
  onFechar,
  rotulo = "link do convite",
  aviso = "Mostrado só uma vez — se perder, reemita.",
}: {
  link: string;
  expiraEm?: string;
  onFechar: () => void;
  rotulo?: string;
  aviso?: string;
}) {
  const [copiado, setCopiado] = useState<"nao" | "sim" | "manual">("nao");
  const campo = useRef<HTMLInputElement>(null);

  async function copiar() {
    // navigator.clipboard só existe em origem segura (HTTPS/localhost). Fora
    // disso, seleciona o texto para o usuário copiar com Ctrl+C.
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(link);
      setCopiado("sim");
    } catch {
      campo.current?.focus();
      campo.current?.select();
      setCopiado("manual");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="eyebrow mb-1">{rotulo}</p>
        <input
          ref={campo}
          readOnly
          value={link}
          aria-label={rotulo}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-transparent font-mono text-xs text-fg-soft outline-none"
        />
      </div>
      {expiraEm ? (
        <p className="text-xs text-fg-faint">
          Expira em{" "}
          <span className="font-mono">
            {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(expiraEm))}
          </span>
          . {aviso}
        </p>
      ) : null}
      {copiado === "manual" ? <p className="text-xs text-warn">Não deu pra copiar automaticamente: o link está selecionado, use Ctrl+C.</p> : null}
      <div className="flex gap-2">
        <Button onClick={copiar} className="flex-1">
          <Copy className="h-4 w-4" />
          {copiado === "sim" ? "Copiado" : "Copiar link"}
        </Button>
        <Button variant="outline" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
