"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FaseComUso } from "@/lib/fases/fases";
import { PALETA_FASES } from "@/lib/fases/regras";
import { criarFaseAction, editarFaseAction, type EstadoFase } from "./actions";

const TERMINAIS = [
  { valor: "", rotulo: "Não — fase normal" },
  { valor: "GANHO", rotulo: "Terminal: ganho" },
  { valor: "PERDIDO", rotulo: "Terminal: perdido" },
] as const;

const SELECT_CLASSE =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Cria (fase = null) ou edita uma fase. Mesmos campos; na edição a chave aparece, fixa. */
export function FaseForm({ pipelineId, fase, onSalvo }: { pipelineId: string; fase: FaseComUso | null; onSalvo: () => void }) {
  const acao = fase ? editarFaseAction : criarFaseAction;
  const [estado, action, pendente] = useActionState(async (prev: EstadoFase, form: FormData) => {
    const r = await acao(prev, form);
    if (r?.ok) onSalvo();
    return r;
  }, undefined);
  const [cor, setCor] = useState<string>(fase?.cor ?? PALETA_FASES[0]);

  return (
    <form action={action} className="space-y-4">
      {fase ? <input type="hidden" name="faseId" value={fase.id} /> : <input type="hidden" name="pipelineId" value={pipelineId} />}

      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" defaultValue={fase?.nome ?? ""} required minLength={2} maxLength={60} autoFocus />
        {fase ? (
          <p className="font-mono text-xs text-fg-faint">
            chave: <span className="text-fg-mute">{fase.chave}</span>
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cor">Cor</Label>
        <div className="flex flex-wrap items-center gap-2">
          {PALETA_FASES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              aria-pressed={cor === c}
              onClick={() => setCor(c)}
              className={`size-6 rounded-full border-2 transition-transform ${cor === c ? "scale-110 border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            id="cor"
            name="cor"
            type="color"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            aria-label="Cor personalizada"
            className="h-7 w-9 cursor-pointer rounded-md border border-input bg-background p-0.5"
          />
          <span className="font-mono text-xs text-fg-faint">{cor}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="limiteDiasAlerta">Alerta após (dias)</Label>
          <Input id="limiteDiasAlerta" name="limiteDiasAlerta" type="number" min={1} max={365} inputMode="numeric" defaultValue={fase?.limiteDiasAlerta ?? ""} placeholder="—" />
          <p className="text-xs text-fg-faint">Vazio = sem alerta de dias na fase.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tipoTerminal">Terminal</Label>
          <select id="tipoTerminal" name="tipoTerminal" defaultValue={fase?.tipoTerminal ?? ""} className={SELECT_CLASSE}>
            {TERMINAIS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Salvando…" : fase ? "Salvar" : "Criar fase"}
      </Button>
    </form>
  );
}
