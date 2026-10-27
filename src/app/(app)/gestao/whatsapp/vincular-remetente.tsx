"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { vincularRemetenteAction } from "./actions";

/** "Vincular a usuário": grava o telefone ou o LID do remetente no usuário escolhido. */
export function VincularRemetente({ remetenteId, usuarios }: { remetenteId: string; usuarios: { id: string; nome: string }[] }) {
  const idSelect = useId();
  const router = useRouter();
  const [usuarioId, setUsuarioId] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function vincular() {
    startTransition(async () => {
      const falha = await executarAcao(() => vincularRemetenteAction(remetenteId, usuarioId), "vincular o remetente");
      setErro(falha);
      if (!falha) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={idSelect} className="sr-only">
          Usuário
        </label>
        <select
          id={idSelect}
          value={usuarioId}
          onChange={(e) => setUsuarioId(e.target.value)}
          className="h-7 rounded-lg border border-input bg-input/30 px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">usuário…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" disabled={pendente || !usuarioId} onClick={vincular}>
          {pendente ? "…" : "Vincular a usuário"}
        </Button>
      </div>
      <MensagemErro falha={erro} className="max-w-xs text-right" />
    </div>
  );
}
