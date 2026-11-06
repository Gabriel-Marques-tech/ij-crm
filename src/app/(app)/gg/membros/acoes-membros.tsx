"use client";

import { useState } from "react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { CAMPO } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROTULO_STATUS_MEMBRO, STATUS_MEMBRO } from "@/lib/gg/modelo";
import { criarMembroAction, ligarContasAction } from "../actions";

/** Novo membro e "ligar contas pelo e-mail" (só para quem edita G&G). */
export function AcoesMembros() {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, setErro, rodar } = useAcao();
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pendente} onClick={() => rodar(() => ligarContasAction(), "ligar as contas", (r) => setAviso(r && "ligados" in r ? `${r.ligados ?? 0} conta(s) ligada(s).` : null))}>
        Ligar contas pelo e-mail
      </Button>
      <Button
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
      >
        Novo membro
      </Button>
      {aviso || erro ? (
        <div className="self-center text-sm text-fg-mute" aria-live="polite">
          {aviso}
          {aberto ? null : <MensagemErro falha={erro} />}
        </div>
      ) : null}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo membro</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rodar(
                () => criarMembroAction({ nome: String(f.get("nome")), email: String(f.get("email") || "") || null, status: String(f.get("status")), entrada: String(f.get("entrada") || "") || null }),
                "cadastrar o membro",
                () => setAberto(false),
              );
            }}
          >
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Nome
              <input name="nome" required maxLength={200} className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              E-mail (opcional; liga a conta do CRM se existir)
              <input name="email" type="email" maxLength={254} className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Status
              <select name="status" defaultValue="ATIVO" className={CAMPO}>
                {STATUS_MEMBRO.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_MEMBRO[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Entrada na IJ (vazio = não informada)
              <input name="entrada" type="date" className={CAMPO} />
            </label>
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Cadastrar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
