"use client";

import { useState } from "react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import type { Opcao } from "@/components/gg/acoes-ocupacao";
import { CAMPO } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { salvarPosicaoAction } from "../actions";

export function NovaPosicao({ areas, cargos, posicoes }: { areas: Opcao[]; cargos: Opcao[]; posicoes: Opcao[] }) {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  const sel = (nome: string, rotulo: string, opcoes: Opcao[], vazio?: string) => (
    <label className="grid gap-1.5 text-xs text-fg-mute">
      {rotulo}
      <select name={nome} required={!vazio} className={CAMPO}>
        {vazio ? <option value="">{vazio}</option> : null}
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        Nova posição
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rodar(() => salvarPosicaoAction(null, { nome: String(f.get("nome")), areaId: String(f.get("areaId")), cargoId: String(f.get("cargoId")), liderancaId: String(f.get("liderancaId") || "") || null }), "criar a posição", () => setAberto(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Nova posição</DialogTitle>
              <DialogDescription>Depois de ter ocupantes, a posição não muda de área nem de cargo (crie outra).</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Nome
              <input name="nome" required maxLength={200} placeholder="Ex.: PM" className={CAMPO} />
            </label>
            {sel("areaId", "Área", areas)}
            {sel("cargoId", "Cargo", cargos)}
            {sel("liderancaId", "Responde a", posicoes, "Ninguém (vira raiz)")}
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Criar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
