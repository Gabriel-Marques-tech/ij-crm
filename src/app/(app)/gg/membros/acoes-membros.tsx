"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { useAcao } from "@/components/gg/use-acao";
import { Button, buttonVariants } from "@/components/ui/button";
import { ligarContasAction } from "../actions";

/**
 * Cadastro de pessoa nova mora em Gestão → Usuários (GAB-105): lá a conta do CRM, o membro e a
 * posição saem juntos. Aqui fica o atalho (gestor/admin) ou o texto (editor de G&G que não é
 * gestor), e o "ligar contas pelo e-mail" para quem edita G&G.
 */
export function AcoesMembros({ editor, gestao }: { editor: boolean; gestao: boolean }) {
  const { pendente, erro, rodar } = useAcao();
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editor ? (
        <Button variant="outline" disabled={pendente} onClick={() => rodar(() => ligarContasAction(), "ligar as contas", (r) => setAviso(r && "ligados" in r ? `${r.ligados ?? 0} conta(s) ligada(s).` : null))}>
          Ligar contas pelo e-mail
        </Button>
      ) : null}
      {gestao ? (
        <Link href="/gestao/usuarios" className={buttonVariants()}>
          <UserPlus className="h-4 w-4" />
          Cadastrar em Gestão → Usuários
        </Link>
      ) : (
        <span className="text-xs text-fg-faint">Pessoa nova: a gestão cadastra em Gestão → Usuários (conta, membro e posição juntos).</span>
      )}
      {aviso || erro ? (
        <div className="self-center text-sm text-fg-mute" aria-live="polite">
          {aviso}
          <MensagemErro falha={erro} />
        </div>
      ) : null}
    </div>
  );
}
