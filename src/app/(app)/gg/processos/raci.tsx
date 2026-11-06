"use client";

import { useState } from "react";
import type { PapelRaci } from "@prisma/client";
import { cn } from "cn";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { CAMPO } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { criarProcessoAction, definirRaciAction } from "../actions";

const ORDEM: (PapelRaci | null)[] = [null, "R", "A", "C", "I"];
const COR: Record<PapelRaci, string> = { R: "border-chart-5 bg-chart-5/10 text-chart-5", A: "border-primary bg-primary-soft text-primary", C: "border-warn/60 text-warn", I: "border-border-strong text-fg-soft" };

export function CelulaRaci({ processoId, cargoId, papel, editor, rotulo }: { processoId: string; cargoId: string; papel: PapelRaci | null; editor: boolean; rotulo: string }) {
  const { pendente, erro, rodar } = useAcao();
  const classe = cn("inline-grid h-8 w-9 place-items-center rounded-md border font-mono text-xs font-semibold", papel ? COR[papel] : "border-border text-fg-faint");
  if (!editor) return <span className={classe}>{papel ?? "·"}</span>;
  const proximo = ORDEM[(ORDEM.indexOf(papel) + 1) % ORDEM.length];
  return (
    <>
      <button type="button" disabled={pendente} aria-label={`${rotulo}: ${papel ?? "nenhum"}. Trocar para ${proximo ?? "nenhum"}`} className={cn(classe, "hover:brightness-125")} onClick={() => rodar(() => definirRaciAction(processoId, cargoId, proximo), "trocar o papel")}>
        {papel ?? "·"}
      </button>
      <MensagemErro falha={erro} className="text-xs" />
    </>
  );
}

export function NovoProcesso() {
  const [nome, setNome] = useState("");
  const { pendente, erro, rodar } = useAcao();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        rodar(() => criarProcessoAction(nome), "criar o processo", () => setNome(""));
      }}
    >
      <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={200} placeholder="Novo processo" aria-label="Nome do processo" className={`${CAMPO} w-48`} />
      <Button size="sm" type="submit" disabled={pendente || !nome.trim()}>
        Criar
      </Button>
      <MensagemErro falha={erro} className="text-xs" />
    </form>
  );
}
