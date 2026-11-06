"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import type { Exibicao } from "@/lib/tarefas/exibicao";
import { PRIORIDADES, ROTULO_PRIORIDADE, recebeTarefa, rotuloResponsavel, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";
import { COLUNAS, type Linha } from "@/lib/tarefas/quadro";
import { IconePrioridade, IconeStatus, corEtiqueta, diaCurto, estadoPrazo } from "./cartao-tarefa";
import { MenuOpcoes } from "./menu";
import type { PatchLocal } from "./detalhe-tarefa";

/** Id de alvo de um grupo/coluna no arrasto (mesmo formato no quadro e na lista). */
export const idColuna = (chave: string) => `col:${chave}`;

const ALTURA: Record<Exibicao["dens"], string> = { compacta: "h-9", padrao: "h-11", confortavel: "h-13" };

type Props = {
  linhas: Linha<TarefaLista>[];
  porId: Map<string, TarefaLista>;
  pessoaPorId: Map<string, PessoaTarefa>;
  pessoas: PessoaTarefa[];
  exibicao: Exibicao;
  hoje: string;
  selecionada: string | null;
  fechados: Set<string>;
  onAlternarGrupo: (chave: string) => void;
  onAbrir: (id: string) => void;
  onSelecionar: (id: string | null) => void;
  onEditar: (id: string, patch: PatchLocal) => void;
  onNovo: (grupo: Linha<TarefaLista>) => void;
  /** Durante o arrasto, grupos vazios aparecem para receber a tarefa. */
  arrastando: boolean;
};

type Edicao = { id: string; campo: "status" | "prio" | "resp"; ancora: HTMLElement } | null;

/**
 * Visão de lista no estilo tabela: cabeçalho mono, grupos com ponto colorido,
 * linhas finas, valores em mono. Edição direta de status, prioridade,
 * responsável (menus) e prazo (campo de data) sem abrir o painel.
 */
export function ListaTarefas({ linhas, porId, pessoaPorId, pessoas, exibicao: e, hoje, selecionada, fechados, onAlternarGrupo, onAbrir, onSelecionar, onEditar, onNovo, arrastando }: Props) {
  const [edicao, setEdicao] = useState<Edicao>(null);
  const P = e.props;
  const grade = { gridTemplateColumns: `20px 56px minmax(240px,1fr) ${P.etiquetas ? "minmax(120px,auto)" : "0"} ${P.prio ? "96px" : "0"} ${P.prazo ? "150px" : "0"} ${P.criada ? "72px" : "0"} 28px` };
  const abrirMenu = (ev: React.MouseEvent<HTMLButtonElement>, id: string, campo: "status" | "prio" | "resp") => {
    ev.stopPropagation();
    onSelecionar(id);
    setEdicao({ id, campo, ancora: ev.currentTarget });
  };
  const t = edicao ? porId.get(edicao.id) : undefined;

  return (
    <div className="min-w-[56rem] flex-1 self-start rounded-lg border border-border" role="table" aria-label="Tarefas">
      <div role="row" className="eyebrow sticky top-0 z-10 grid h-9 items-center gap-4 border-b border-border bg-background px-4" style={grade}>
        <span />
        <span role="columnheader">ID</span>
        <span role="columnheader">Título</span>
        <span role="columnheader">{P.etiquetas ? "Etiquetas" : ""}</span>
        <span role="columnheader">{P.prio ? "Prior." : ""}</span>
        <span role="columnheader">{P.prazo ? "Prazo" : ""}</span>
        <span role="columnheader">{P.criada ? "Criada" : ""}</span>
        <span />
      </div>
      {linhas.map((l) => {
        if (!l.tarefas.length && !e.vazios && !arrastando) return null;
        const fechado = fechados.has(`l:${l.chave}`);
        return (
          <Grupo key={l.chave} chave={l.chave} rotulo={`${l.nome || "Tarefas"}, ${l.tarefas.length}`}>
            {l.nome ? (
              <div className="flex h-9 items-center gap-2 border-b border-white/5 bg-muted/60 px-4 text-sm font-medium">
                <button type="button" onClick={() => onAlternarGrupo(`l:${l.chave}`)} aria-expanded={!fechado} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {l.cor ? <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: l.cor }} /> : l.pessoa ? <Avatar nome={l.pessoa.nome} usuarioId={l.pessoa.id} fotoEm={l.pessoa.fotoEm} className="size-[18px] text-[8px]" /> : <span className="size-[18px] rounded-full border border-dashed border-border-strong" />}
                  <span className="truncate">{l.nome}</span>
                  <span className="font-mono text-xs text-fg-faint tabular">{l.tarefas.length}</span>
                </button>
                <button type="button" onClick={() => onNovo(l)} aria-label={`Nova tarefa em ${l.nome}`} className="rounded p-1 text-fg-faint hover:bg-surface hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
                <ChevronDown className={cn("size-3.5 text-fg-faint transition-transform", fechado && "-rotate-90")} />
              </div>
            ) : null}
            {fechado
              ? null
              : l.tarefas.map((x) => {
                  const fim = x.status === "FEITA" || x.status === "CANCELADA";
                  const estado = x.prazo && !fim ? estadoPrazo(x.prazo, hoje) : null;
                  const filhos = [...porId.values()].filter((f) => f.paiId === x.id);
                  return (
                    <LinhaArrastavel
                      key={x.id}
                      tarefa={x}
                      onAbrir={() => onAbrir(x.id)}
                      onSelecionar={() => onSelecionar(x.id)}
                      className={cn("group/tr grid cursor-pointer items-center gap-4 border-b border-white/5 px-4 text-sm outline-none last:border-b-0 hover:bg-white/[.03] focus-visible:bg-white/[.03]", ALTURA[e.dens], selecionada === x.id && "bg-white/[.06]", fim && "opacity-60")}
                      style={grade}
                    >
                      {P.status ? (
                        <button type="button" aria-label="Mudar status" onClick={(ev) => abrirMenu(ev, x.id, "status")} className="rounded p-0.5 group-hover/tr:bg-white/[.07] hover:bg-white/[.14]">
                          <IconeStatus status={x.status} className="size-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}
                      <span className="font-mono text-[11px] text-fg-mute">{P.id ? `#${x.numero}` : ""}</span>
                      <span className="flex min-w-0 items-center gap-2 truncate text-foreground">
                        {P.pai && x.paiId ? <span className="font-mono text-[11px] text-fg-faint">↳ #{porId.get(x.paiId)?.numero}</span> : null}
                        <span className="truncate">{x.titulo}</span>
                        {P.sub && filhos.length ? <span className="font-mono text-[11px] text-fg-faint">{filhos.filter((f) => f.status === "FEITA" || f.status === "CANCELADA").length}/{filhos.length}</span> : null}
                      </span>
                      <span className="flex gap-1 overflow-hidden">
                        {P.etiquetas
                          ? x.etiquetas.map((et) => (
                              <span key={et} className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-1.5 font-mono text-[10px] tracking-wider text-fg-mute uppercase">
                                <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: corEtiqueta(et) }} />
                                {et}
                              </span>
                            ))
                          : null}
                      </span>
                      {P.prio ? (
                        <button type="button" aria-label="Mudar prioridade" onClick={(ev) => abrirMenu(ev, x.id, "prio")} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[11px] text-fg-mute group-hover/tr:bg-white/[.07] hover:bg-white/[.14]">
                          <IconePrioridade prioridade={x.prioridade} className="size-3.5" />
                          {x.prioridade === "SEM_PRIORIDADE" ? "—" : ROTULO_PRIORIDADE[x.prioridade].toLowerCase()}
                        </button>
                      ) : (
                        <span />
                      )}
                      {P.prazo ? (
                        <label onClick={(ev) => ev.stopPropagation()} className={cn("relative flex items-center rounded px-1 py-0.5 font-mono text-[11px] tabular group-hover/tr:bg-white/[.07] hover:bg-white/[.14]", estado === "atrasada" ? "text-danger" : estado === "hoje" ? "text-warn" : x.prazo ? "text-fg-soft" : "text-fg-faint")}>
                          <span className="sr-only">Prazo</span>
                          {x.prazo ? `${diaCurto(x.prazo)}${estado === "atrasada" ? " · atrasada" : estado === "hoje" ? " · hoje" : ""}` : "—"}
                          <input type="date" value={x.prazo ?? ""} onChange={(ev) => onEditar(x.id, { prazo: ev.target.value || null })} aria-label="Prazo" className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]" />
                        </label>
                      ) : (
                        <span />
                      )}
                      <span className="font-mono text-[11px] text-fg-faint">{P.criada ? diaCurto(new Date(x.criadoEmMs).toISOString().slice(0, 10)) : ""}</span>
                      {P.resp ? (
                        <button type="button" aria-label="Mudar responsável" onClick={(ev) => abrirMenu(ev, x.id, "resp")} className="rounded-full group-hover/tr:ring-2 group-hover/tr:ring-white/10 hover:ring-white/20">
                          {x.responsavelId && pessoaPorId.get(x.responsavelId) ? <Avatar nome={pessoaPorId.get(x.responsavelId)!.nome} usuarioId={x.responsavelId} fotoEm={pessoaPorId.get(x.responsavelId)!.fotoEm} className="size-[22px] text-[9px]" /> : <span className="block size-[22px] rounded-full border border-dashed border-border-strong" />}
                        </button>
                      ) : (
                        <span />
                      )}
                    </LinhaArrastavel>
                  );
                })}
          </Grupo>
        );
      })}
      {edicao && t && edicao.campo === "status" ? (
        <MenuOpcoes ancora={edicao.ancora} titulo="Mudar status" busca={false} opcoes={COLUNAS.map((c, i) => ({ valor: c.status, rotulo: c.nome, icone: <IconeStatus status={c.status} className="size-3.5" />, atalho: String(i + 1) }))} selecionadas={[t.status]} onEscolher={(v) => onEditar(t.id, { status: v as StatusTarefa })} onFechar={() => setEdicao(null)} />
      ) : null}
      {edicao && t && edicao.campo === "prio" ? (
        <MenuOpcoes ancora={edicao.ancora} titulo="Prioridade" busca={false} opcoes={PRIORIDADES.map((p) => ({ valor: p.k, rotulo: p.nome, icone: <IconePrioridade prioridade={p.k} className="size-3.5" /> }))} selecionadas={[t.prioridade]} onEscolher={(v) => onEditar(t.id, { prioridade: v as PrioridadeTarefa })} onFechar={() => setEdicao(null)} />
      ) : null}
      {edicao && t && edicao.campo === "resp" ? (
        <MenuOpcoes
          ancora={edicao.ancora}
          titulo="Responsável"
          opcoes={[{ valor: "", rotulo: "Sem responsável", icone: <span className="size-4 rounded-full border border-dashed border-border-strong" /> }, ...pessoas.map((p) => ({ valor: p.id, rotulo: rotuloResponsavel(p), desabilitada: !recebeTarefa(p) && p.id !== t.responsavelId, icone: <Avatar nome={p.nome} usuarioId={p.id} fotoEm={p.fotoEm} className="size-4 text-[8px]" /> }))]}
          selecionadas={[t.responsavelId ?? ""]}
          onEscolher={(v) => onEditar(t.id, { responsavelId: v || null })}
          onFechar={() => setEdicao(null)}
        />
      ) : null}
    </div>
  );
}

/** Grupo da lista como alvo: soltar no cabeçalho ou no vão do grupo manda para o fim dele. */
function Grupo({ chave, rotulo, children }: { chave: string; rotulo: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: idColuna(chave) });
  return (
    <section ref={setNodeRef} aria-label={rotulo} className={cn("transition-colors", isOver && "bg-primary/[.06] ring-1 ring-primary/40 ring-inset")}>
      {children}
    </section>
  );
}

/** Linha arrastável e alvo: soltar sobre ela põe a tarefa logo antes (linha de inserção no topo). */
function LinhaArrastavel({ tarefa, onAbrir, onSelecionar, className, style, children }: { tarefa: TarefaLista; onAbrir: () => void; onSelecionar: () => void; className: string; style: React.CSSProperties; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tarefa.id });
  const alvo = useDroppable({ id: tarefa.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        alvo.setNodeRef(el);
      }}
      {...attributes}
      {...listeners}
      role="row"
      data-id={tarefa.id}
      aria-roledescription="tarefa arrastável"
      aria-label={`#${tarefa.numero} ${tarefa.titulo}. Enter abre; espaço pega para mover.`}
      onClick={onAbrir}
      onMouseEnter={onSelecionar}
      // Enter abre; o resto (espaço, setas) vai para o arrasto por teclado.
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget) return; // espaço/Enter num botão da linha é do botão
        if (ev.key === "Enter") onAbrir();
        else listeners?.onKeyDown?.(ev);
      }}
      className={cn(className, "touch-manipulation", isDragging && "opacity-40", alvo.isOver && !isDragging && "shadow-[inset_0_2px_0_var(--color-primary)]")}
      style={style}
    >
      {children}
    </div>
  );
}
