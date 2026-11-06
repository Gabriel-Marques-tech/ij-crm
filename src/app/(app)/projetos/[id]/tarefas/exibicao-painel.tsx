"use client";

import { Columns3, List } from "lucide-react";
import { cn } from "cn";
import { EXIBICAO_PADRAO, ROTULO_AGRUPAR, ROTULO_ORDENAR, ROTULO_PROPRIEDADE, type Exibicao, type Propriedade } from "@/lib/tarefas/exibicao";
import { Popover } from "./menu";

const CAMPO = "h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring";

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex h-8 items-center justify-between gap-3 px-2 text-sm">
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({ valor, opcoes, onMudar }: { valor: T; opcoes: [T, string][]; onMudar: (v: T) => void }) {
  return (
    <select value={valor} onChange={(e) => onMudar(e.target.value as T)} className={CAMPO}>
      {opcoes.map(([v, r]) => (
        <option key={v} value={v}>
          {r}
        </option>
      ))}
    </select>
  );
}

/** Painel de Exibição (o "Display" do Linear): layout, agrupar, ordenar, concluídas, subtarefas, densidade, propriedades. */
export function ExibicaoPainel({ ancora, exibicao: e, onMudar, onFechar }: { ancora: HTMLElement | null; exibicao: Exibicao; onMudar: (e: Exibicao) => void; onFechar: () => void }) {
  const set = <K extends keyof Exibicao>(k: K, v: Exibicao[K]) => onMudar({ ...e, [k]: v });
  const prop = (k: Propriedade) => onMudar({ ...e, props: { ...e.props, [k]: !e.props[k] } });
  return (
    <Popover ancora={ancora} onFechar={onFechar} rotulo="Exibição" className="w-80 max-w-80 gap-0 py-1">
      <p className="eyebrow px-2 pt-1 pb-1.5">Layout</p>
      <div className="mx-2 mb-2 grid grid-cols-2 gap-0.5 rounded-md border border-border p-0.5">
        {(["quadro", "lista"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={e.vista === v} onClick={() => set("vista", v)} className={cn("flex h-7 items-center justify-center gap-1.5 rounded text-xs", e.vista === v ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
            {v === "quadro" ? <Columns3 className="size-3.5" /> : <List className="size-3.5" />}
            {v === "quadro" ? "Quadro" : "Lista"}
          </button>
        ))}
      </div>
      <Linha rotulo="Agrupar por">
        <Select valor={e.agrupar} opcoes={Object.entries(ROTULO_AGRUPAR) as [Exibicao["agrupar"], string][]} onMudar={(v) => set("agrupar", v)} />
      </Linha>
      <Linha rotulo="Ordenar por">
        <Select valor={e.ordenar} opcoes={Object.entries(ROTULO_ORDENAR) as [Exibicao["ordenar"], string][]} onMudar={(v) => set("ordenar", v)} />
      </Linha>
      <Linha rotulo="Direção">
        <Select valor={e.ordemDesc ? "desc" : "asc"} opcoes={[["asc", "Crescente"], ["desc", "Decrescente"]]} onMudar={(v) => set("ordemDesc", v === "desc")} />
      </Linha>
      <Linha rotulo="Concluídas">
        <Select valor={e.concluidas} opcoes={[["todas", "Todas"], ["semana", "Última semana"], ["mes", "Último mês"], ["nenhuma", "Nenhuma"]]} onMudar={(v) => set("concluidas", v)} />
      </Linha>
      <Linha rotulo="Subtarefas">
        <Select valor={e.subtarefas} opcoes={[["todas", "Em todo lugar"], ["lista", "Só na lista"], ["nenhuma", "Nenhuma"]]} onMudar={(v) => set("subtarefas", v)} />
      </Linha>
      <Linha rotulo="Densidade">
        <Select valor={e.dens} opcoes={[["compacta", "Compacta"], ["padrao", "Padrão"], ["confortavel", "Confortável"]]} onMudar={(v) => set("dens", v)} />
      </Linha>
      <label className="flex h-8 items-center gap-2 px-2 text-sm">
        <input type="checkbox" checked={e.recolhidos} onChange={(ev) => set("recolhidos", ev.target.checked)} className="accent-primary" /> Backlog e Cancelada abertas
      </label>
      <label className="flex h-8 items-center gap-2 px-2 text-sm">
        <input type="checkbox" checked={e.vazios} onChange={(ev) => set("vazios", ev.target.checked)} className="accent-primary" /> Mostrar colunas e grupos vazios
      </label>
      <p className="eyebrow px-2 pt-2 pb-1.5">Propriedades exibidas</p>
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {(Object.keys(ROTULO_PROPRIEDADE) as Propriedade[]).map((k) => (
          <button key={k} type="button" aria-pressed={e.props[k]} onClick={() => prop(k)} className={cn("h-6 rounded-full border px-2.5 text-xs", e.props[k] ? "border-border-strong bg-surface text-foreground" : "border-border text-fg-mute hover:text-foreground")}>
            {ROTULO_PROPRIEDADE[k]}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onMudar(EXIBICAO_PADRAO)} className="mx-1 mt-1 h-7 rounded-md border-t border-border px-2 text-left text-xs text-fg-mute hover:text-foreground">
        Voltar ao padrão
      </button>
    </Popover>
  );
}
