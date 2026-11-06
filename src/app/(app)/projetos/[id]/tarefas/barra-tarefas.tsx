"use client";

import { useRef, useState, type RefObject } from "react";
import { Columns3, List, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import type { Exibicao } from "@/lib/tarefas/exibicao";
import { DIMENSOES, FILTROS_VAZIOS, OPCOES_PRAZO, ROTULO_DIMENSAO, SEM_RESPONSAVEL_FILTRO, contarAtivos, type Dimensao, type Filtros } from "@/lib/tarefas/filtros";
import { PRIORIDADES, type PessoaTarefa } from "@/lib/tarefas/modelo";
import { COLUNAS } from "@/lib/tarefas/quadro";
import { IconePrioridade, IconeStatus, corEtiqueta } from "./cartao-tarefa";
import { ExibicaoPainel } from "./exibicao-painel";
import { MenuOpcoes, type Opcao } from "./menu";

const ATRASO_BUSCA_MS = 250;

type Props = {
  filtros: Filtros;
  onMudarFiltros: (f: Filtros) => void;
  exibicao: Exibicao;
  onMudarExibicao: (e: Exibicao) => void;
  pessoas: PessoaTarefa[];
  etiquetas: string[];
  visiveis: number;
  total: number;
  /** Refs dos botões para os atalhos F e D abrirem os menus. */
  refFiltro: RefObject<HTMLButtonElement | null>;
  refExibicao: RefObject<HTMLButtonElement | null>;
  menuAberto: { tipo: "filtro" | "exibicao"; ancora: HTMLElement | null } | null;
  onMenu: (m: { tipo: "filtro" | "exibicao"; ancora: HTMLElement | null } | null) => void;
};

/** Filtro (categoria → valores, com "é / não é"), busca, Exibição e o seletor quadro/lista. */
export function BarraTarefas({ filtros, onMudarFiltros, exibicao, onMudarExibicao, pessoas, etiquetas, visiveis, total, refFiltro, refExibicao, menuAberto, onMenu }: Props) {
  const [dimensao, setDimensao] = useState<Dimensao | null>(null);
  const [ancoraChip, setAncoraChip] = useState<HTMLElement | null>(null);
  // Rascunho da busca re-sincronizado quando a URL muda por fora (Limpar, voltar).
  const [busca, setBusca] = useState(filtros.q);
  const [baseBusca, setBaseBusca] = useState(filtros.q);
  if (baseBusca !== filtros.q) {
    setBaseBusca(filtros.q);
    setBusca(filtros.q);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const opcoesDe = (k: Dimensao): Opcao[] => {
    switch (k) {
      case "resp":
        return [...pessoas.map((p) => ({ valor: p.id, rotulo: p.nome, icone: <Avatar nome={p.nome} usuarioId={p.id} fotoEm={p.fotoEm} className="size-4 text-[8px]" /> })), { valor: SEM_RESPONSAVEL_FILTRO, rotulo: "Sem responsável", icone: <span className="size-4 rounded-full border border-dashed border-border-strong" /> }];
      case "status":
        return COLUNAS.map((c) => ({ valor: c.status, rotulo: c.nome, icone: <IconeStatus status={c.status} className="size-3.5" /> }));
      case "prio":
        return PRIORIDADES.map((p) => ({ valor: p.k, rotulo: p.nome, icone: <IconePrioridade prioridade={p.k} className="size-3.5" /> }));
      case "etiqueta":
        return etiquetas.map((e) => ({ valor: e, rotulo: e, icone: <span className="size-2 rounded-full" style={{ backgroundColor: corEtiqueta(e) }} /> }));
      case "prazo":
        return OPCOES_PRAZO.map((o) => ({ valor: o.valor, rotulo: o.rotulo }));
    }
  };
  const rotuloValor = (k: Dimensao, v: string) => opcoesDe(k).find((o) => o.valor === v)?.rotulo ?? v;
  const alternar = (k: Dimensao, v: string) => {
    const lista = filtros[k] as string[];
    onMudarFiltros({ ...filtros, [k]: lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v] });
  };
  const alternarOperador = (k: Dimensao) => onMudarFiltros({ ...filtros, nao: filtros.nao.includes(k) ? filtros.nao.filter((x) => x !== k) : [...filtros.nao, k] });
  const limpar = (k: Dimensao) => onMudarFiltros({ ...filtros, [k]: [], nao: filtros.nao.filter((x) => x !== k) });
  const fecharMenus = () => {
    onMenu(null);
    setDimensao(null);
    setAncoraChip(null);
  };

  const ativos = contarAtivos(filtros);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button ref={refFiltro} variant="outline" size="sm" aria-expanded={menuAberto?.tipo === "filtro"} onClick={(e) => onMenu(menuAberto?.tipo === "filtro" ? null : { tipo: "filtro", ancora: e.currentTarget })}>
        <SlidersHorizontal /> Filtro
        <kbd className="rounded bg-surface-strong px-1 font-mono text-[10px] text-fg-mute">F</kbd>
      </Button>
      {menuAberto?.tipo === "filtro" && !dimensao ? (
        <MenuOpcoes ancora={menuAberto.ancora} titulo="Filtrar por…" busca={false} opcoes={DIMENSOES.map((k) => ({ valor: k, rotulo: ROTULO_DIMENSAO[k] }))} onEscolher={(k) => setDimensao(k as Dimensao)} onFechar={fecharMenus} />
      ) : null}
      {dimensao ? (
        <MenuOpcoes ancora={ancoraChip ?? menuAberto?.ancora ?? null} titulo={ROTULO_DIMENSAO[dimensao]} opcoes={opcoesDe(dimensao)} selecionadas={filtros[dimensao]} multi onEscolher={(v) => alternar(dimensao, v)} onFechar={fecharMenus} />
      ) : null}

      {DIMENSOES.filter((k) => filtros[k].length).map((k) => {
        const nao = filtros.nao.includes(k);
        const nomes = filtros[k].map((v) => rotuloValor(k, v));
        return (
          <span key={k} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface pr-1 pl-2.5 text-xs">
            <span className="text-fg-mute">{ROTULO_DIMENSAO[k]}</span>
            <button type="button" onClick={() => alternarOperador(k)} title={`Trocar para “${nao ? "é" : "não é"}”`} className="rounded px-1 text-fg-soft hover:bg-surface-strong hover:text-foreground">
              {nao ? "não é" : "é"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                setAncoraChip(e.currentTarget);
                setDimensao(k);
                onMenu({ tipo: "filtro", ancora: e.currentTarget });
              }}
              className="max-w-48 truncate font-medium text-foreground hover:underline"
            >
              {nomes.length > 2 ? `${nomes.length} valores` : nomes.join(", ")}
            </button>
            <button type="button" onClick={() => limpar(k)} aria-label={`Remover filtro ${ROTULO_DIMENSAO[k]}`} className="rounded-full p-0.5 text-fg-faint hover:bg-surface-strong hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {ativos ? (
        <Button variant="ghost" size="xs" onClick={() => onMudarFiltros(FILTROS_VAZIOS)}>
          Limpar
        </Button>
      ) : null}
      <span className="font-mono text-[11px] text-fg-faint tabular">
        {visiveis}/{total}
      </span>

      <span className="flex-1" />

      <label className="flex h-7 items-center gap-1.5 rounded-lg border border-input px-2 text-fg-faint focus-within:border-ring">
        <Search className="size-3.5" />
        <span className="sr-only">Buscar tarefa</span>
        <input
          value={busca}
          placeholder="Buscar título ou #id"
          onChange={(e) => {
            const v = e.target.value;
            setBusca(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => onMudarFiltros({ ...filtros, q: v }), ATRASO_BUSCA_MS);
          }}
          className="w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-fg-faint"
        />
      </label>
      <Button ref={refExibicao} variant="outline" size="sm" aria-expanded={menuAberto?.tipo === "exibicao"} onClick={(e) => onMenu(menuAberto?.tipo === "exibicao" ? null : { tipo: "exibicao", ancora: e.currentTarget })}>
        <SlidersHorizontal className="rotate-90" /> Exibição
      </Button>
      {menuAberto?.tipo === "exibicao" ? <ExibicaoPainel ancora={menuAberto.ancora} exibicao={exibicao} onMudar={onMudarExibicao} onFechar={fecharMenus} /> : null}
      <div role="group" aria-label="Layout" className="flex rounded-lg border border-border p-0.5">
        {(["quadro", "lista"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={exibicao.vista === v} onClick={() => onMudarExibicao({ ...exibicao, vista: v })} className={cn("flex h-6 items-center gap-1 rounded-md px-2 text-xs", exibicao.vista === v ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
            {v === "quadro" ? <Columns3 className="size-3.5" /> : <List className="size-3.5" />}
            {v === "quadro" ? "Quadro" : "Lista"}
          </button>
        ))}
      </div>
    </div>
  );
}
