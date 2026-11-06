"use client";

import { useState, useTransition } from "react";
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import { Trash2, X } from "lucide-react";
import { cn } from "cn";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { COLUNAS } from "@/lib/tarefas/quadro";
import { DESCRICAO_MAX, ETIQUETA_MAX, PRIORIDADES, TITULO_MAX, normalizarEtiquetas, recebeTarefa, rotuloResponsavel, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";
import { editarTarefaAction, excluirTarefaAction } from "./actions";
import { IconePrioridade, IconeStatus, corEtiqueta } from "./cartao-tarefa";

const CAMPO = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export type PatchLocal = Partial<Pick<TarefaLista, "titulo" | "descricao" | "status" | "prioridade" | "responsavelId" | "prazo" | "etiquetas">>;

/**
 * Painel lateral da tarefa: título, descrição, status, prioridade, responsável,
 * prazo, etiquetas e excluir. Cada campo salva ao mudar; o quadro aplica
 * otimista pelo `onMudou` e o servidor confirma pelo revalidate.
 */
export function DetalheTarefa({
  projetoId,
  tarefa,
  pessoas,
  etiquetasSugeridas,
  onFechar,
  onMudou,
  onExcluida,
}: {
  projetoId: string;
  tarefa: TarefaLista | null;
  pessoas: PessoaTarefa[];
  etiquetasSugeridas: string[];
  onFechar: () => void;
  onMudou: (id: string, patch: PatchLocal) => void;
  onExcluida: (id: string) => void;
}) {
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [, startTransition] = useTransition();

  function salvar(patch: PatchLocal) {
    if (!tarefa) return;
    setErro(null);
    // Valores de antes, para desfazer o otimista se o servidor recusar (ex.: responsável fora da equipe).
    const antes = Object.fromEntries(Object.keys(patch).map((k) => [k, tarefa[k as keyof PatchLocal]])) as PatchLocal;
    const id = tarefa.id;
    onMudou(id, patch);
    startTransition(async () => {
      const falha = await executarAcao(() => editarTarefaAction(projetoId, id, patch), "salvar a tarefa");
      if (falha) {
        onMudou(id, antes);
        setErro(falha);
      }
    });
  }

  function excluir() {
    if (!tarefa || !window.confirm(`Excluir #${tarefa.numero} ${tarefa.titulo}? As subtarefas vão junto.`)) return;
    const id = tarefa.id;
    startTransition(async () => {
      const falha = await executarAcao(() => excluirTarefaAction(projetoId, id), "excluir a tarefa");
      if (falha) setErro(falha);
      else onExcluida(id);
    });
  }

  return (
    <Sheet open={tarefa !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        {tarefa ? (
          <>
            <SheetHeader>
              <p className="font-mono text-xs text-fg-mute">#{tarefa.numero}</p>
              <SheetTitle className="sr-only">Tarefa #{tarefa.numero}</SheetTitle>
              <SheetDescription className="sr-only">Editar título, descrição, status, prioridade, responsável, prazo e etiquetas.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <CampoTexto chave={tarefa.id} rotulo="Título" valor={tarefa.titulo} max={TITULO_MAX} obrigatorio className="text-base font-semibold" onSalvar={(v) => salvar({ titulo: v })} />
              <CampoTexto chave={tarefa.id} rotulo="Descrição" valor={tarefa.descricao ?? ""} max={DESCRICAO_MAX} multilinha onSalvar={(v) => salvar({ descricao: v || null })} />
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Status</span>
                <span className="flex items-center gap-2">
                  <IconeStatus status={tarefa.status} className="size-4" />
                  <select value={tarefa.status} onChange={(e) => salvar({ status: e.target.value as StatusTarefa })} className={CAMPO}>
                    {COLUNAS.map((c) => (
                      <option key={c.status} value={c.status}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Prioridade</span>
                <span className="flex items-center gap-2">
                  <IconePrioridade prioridade={tarefa.prioridade} className="size-4" />
                  <select value={tarefa.prioridade} onChange={(e) => salvar({ prioridade: e.target.value as PrioridadeTarefa })} className={CAMPO}>
                    {PRIORIDADES.map((p) => (
                      <option key={p.k} value={p.k}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Responsável</span>
                <select value={tarefa.responsavelId ?? ""} onChange={(e) => salvar({ responsavelId: e.target.value || null })} className={CAMPO}>
                  <option value="">Sem responsável</option>
                  {pessoas.map((p) => (
                    <option key={p.id} value={p.id} disabled={!recebeTarefa(p) && p.id !== tarefa.responsavelId}>
                      {rotuloResponsavel(p)}
                    </option>
                  ))}
                </select>
                {pessoas.find((p) => p.id === tarefa.responsavelId)?.afastado ? <span className="text-xs text-warn">Afastado segundo G&amp;G: confira antes de contar com essa pessoa.</span> : null}
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Prazo</span>
                <Input type="date" value={tarefa.prazo ?? ""} onChange={(e) => salvar({ prazo: e.target.value || null })} className="[color-scheme:dark]" />
              </label>
              <Etiquetas chave={tarefa.id} valor={tarefa.etiquetas} sugeridas={etiquetasSugeridas} onSalvar={(v) => salvar({ etiquetas: v })} />
              <MensagemErro falha={erro} />
              <div className="mt-2 flex items-center justify-between border-t border-border pt-4">
                <p className="font-mono text-[11px] text-fg-faint">criada {new Date(tarefa.criadoEmMs).toLocaleDateString("pt-BR")}</p>
                <Button type="button" variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={excluir}>
                  <Trash2 /> Excluir
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Etiquetas como chips removíveis + campo com sugestões do projeto (Enter ou vírgula adiciona). */
function Etiquetas({ chave, valor, sugeridas, onSalvar }: { chave: string; valor: string[]; sugeridas: string[]; onSalvar: (v: string[]) => void }) {
  const [texto, setTexto] = useState("");
  const [base, setBase] = useState(chave);
  if (base !== chave) {
    setBase(chave);
    setTexto("");
  }
  const adicionar = () => {
    const novas = normalizarEtiquetas([...valor, ...texto.split(",")]);
    setTexto("");
    if (novas.length !== valor.length || novas.some((e, i) => e !== valor[i])) onSalvar(novas);
  };
  const listaId = `etiquetas-${chave}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">Etiquetas</span>
      <div className="flex flex-wrap gap-1.5">
        {valor.map((e) => (
          <span key={e} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-white/10 pr-1 pl-2 text-xs text-fg-soft">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: corEtiqueta(e) }} />
            {e}
            <button type="button" aria-label={`Remover etiqueta ${e}`} onClick={() => onSalvar(valor.filter((x) => x !== e))} className="rounded p-0.5 text-fg-faint hover:bg-surface-strong hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        list={listaId}
        value={texto}
        maxLength={ETIQUETA_MAX}
        placeholder="Adicionar etiqueta (Enter)"
        aria-label="Nova etiqueta"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => texto.trim() && adicionar()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            adicionar();
          }
        }}
        className={CAMPO}
      />
      <datalist id={listaId}>
        {sugeridas.filter((s) => !valor.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

/** Texto que salva ao sair do campo (blur) ou com Enter (uma linha). `chave` reinicia o rascunho ao trocar de tarefa. */
function CampoTexto({
  chave,
  rotulo,
  valor,
  max,
  obrigatorio = false,
  multilinha = false,
  className,
  onSalvar,
}: {
  chave: string;
  rotulo: string;
  valor: string;
  max: number;
  obrigatorio?: boolean;
  multilinha?: boolean;
  className?: string;
  onSalvar: (v: string) => void;
}) {
  const [base, setBase] = useState({ chave, valor });
  const [rascunho, setRascunho] = useState(valor);
  if (base.chave !== chave || base.valor !== valor) {
    setBase({ chave, valor });
    setRascunho(valor);
  }
  const confirmar = () => {
    const v = rascunho.trim();
    if (v === valor.trim() || (obrigatorio && !v)) return setRascunho(valor);
    onSalvar(v);
  };
  const comum = { value: rascunho, maxLength: max, onBlur: confirmar, "aria-label": rotulo } as const;
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{rotulo}</span>
      {multilinha ? (
        <textarea {...comum} rows={4} placeholder="Adicionar descrição…" onChange={(e) => setRascunho(e.target.value)} className={cn(CAMPO, "h-auto resize-y py-1.5", className)} />
      ) : (
        <input
          {...comum}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRascunho(valor);
          }}
          className={cn(CAMPO, className)}
        />
      )}
    </label>
  );
}
