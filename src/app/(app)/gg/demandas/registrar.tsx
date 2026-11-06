"use client";

import { useState } from "react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { CAMPO, Painel } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { LIMITE_DEMANDA } from "@/lib/gg/modelo";
import { cancelarDemandaAction, registrarDemandaAction } from "../actions";

type M = { id: string; nome: string; rosa: number; azul: number };

function Saldo({ n, max, cor }: { n: number; max: number; cor: string }) {
  return (
    <span className="flex gap-1" aria-label={`${n} de ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={`size-3 rounded-[3px] border ${i < n ? cor : "border-border-strong"}`} />
      ))}
    </span>
  );
}

export function RegistrarDemanda({ membros }: { membros: M[] }) {
  const [quem, setQuem] = useState("");
  const [tipo, setTipo] = useState("ROSA");
  const [just, setJust] = useState("");
  const { pendente, erro, rodar } = useAcao();
  const m = membros.find((x) => x.id === quem);
  return (
    <Painel titulo="Registrar demanda">
      <form
        className="grid gap-3 p-4 lg:grid-cols-[14rem_9rem_minmax(0,1fr)_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          rodar(() => registrarDemandaAction(quem, tipo, just), "registrar a demanda", () => setJust(""));
        }}
      >
        <label className="grid gap-1.5 text-xs text-fg-mute">
          Pessoa
          <select required value={quem} onChange={(e) => setQuem(e.target.value)} className={CAMPO}>
            <option value="">Escolha…</option>
            {membros.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-fg-mute">
          Tipo da demanda
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={CAMPO}>
            <option value="ROSA">Rosa</option>
            <option value="AZUL">Azul</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-fg-mute">
          Breve justificativa
          <input required maxLength={1000} value={just} onChange={(e) => setJust(e.target.value)} placeholder="Ex.: conduziu a reunião geral de outubro" className={CAMPO} />
        </label>
        <Button type="submit" disabled={pendente || !quem}>
          Registrar e assinar
        </Button>
        {m ? (
          <p className="flex flex-wrap items-center gap-3 text-xs text-fg-mute lg:col-span-4">
            Saldo de {m.nome.split(" ")[0]}: <Saldo n={m.rosa} max={LIMITE_DEMANDA.ROSA} cor="border-pink-400 bg-pink-400" /> <span className="font-mono">{m.rosa}/{LIMITE_DEMANDA.ROSA}</span>
            <Saldo n={m.azul} max={LIMITE_DEMANDA.AZUL} cor="border-chart-4 bg-chart-4" /> <span className="font-mono">{m.azul}/{LIMITE_DEMANDA.AZUL}</span>
          </p>
        ) : null}
        <MensagemErro falha={erro} className="text-sm lg:col-span-4" />
      </form>
    </Painel>
  );
}

export function Cancelar({ id, rotulo }: { id: string; rotulo: string }) {
  const [confirmar, setConfirmar] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  return confirmar ? (
    <span className="inline-flex items-center gap-1.5" aria-live="polite">
      <Button size="sm" variant="destructive" disabled={pendente} onClick={() => rodar(() => cancelarDemandaAction(id), "cancelar a demanda")}>
        Cancelar demanda
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
        Manter
      </Button>
      <MensagemErro falha={erro} className="text-xs" />
    </span>
  ) : (
    <Button size="sm" variant="ghost" aria-label={rotulo} onClick={() => setConfirmar(true)}>
      Cancelar
    </Button>
  );
}
