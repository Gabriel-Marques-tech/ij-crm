"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { DESCRICAO_MAX } from "@/lib/projetos/descricao";
import { editarCampoAction } from "../../kanban/actions";

/**
 * Bloco "Descrição" do card: texto puro (React escapa; sem HTML/markdown),
 * quebras de linha preservadas. Clique edita num textarea; salva pela mesma
 * action dos campos inline (Timeline CAMPO_ALTERADO no servidor).
 * Ctrl/Cmd+Enter salva, Esc cancela. `somenteLeitura` (VISUALIZADOR): só o texto.
 */
export function DescricaoCard({ cardId, valor, somenteLeitura = false }: { cardId: string; valor: string | null; somenteLeitura?: boolean }) {
  const atual = valor ?? "";
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(atual);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function abrir() {
    setRascunho(atual);
    setErro(null);
    setEditando(true);
  }

  function cancelar() {
    setRascunho(atual);
    setErro(null);
    setEditando(false);
  }

  function salvar() {
    if (rascunho.trim() === atual.trim()) return cancelar();
    startTransition(async () => {
      const falha = await executarAcao(() => editarCampoAction(cardId, "descricao", rascunho), "salvar a descrição");
      setErro(falha);
      if (!falha) setEditando(false);
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Descrição</h2>
      {somenteLeitura ? (
        <p data-testid="descricao-texto" className="text-sm break-words whitespace-pre-wrap">
          {atual ? <span className="text-foreground">{atual}</span> : <span className="text-fg-faint">Sem descrição</span>}
        </p>
      ) : editando ? (
        <>
          <textarea
            aria-label="Descrição"
            autoFocus
            rows={6}
            value={rascunho}
            maxLength={DESCRICAO_MAX}
            disabled={pendente}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelar();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                salvar();
              }
            }}
            className="w-full resize-y rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[11px] text-fg-faint tabular">
              {rascunho.length}/{DESCRICAO_MAX}
            </span>
            <span className="flex-1" />
            <Button type="button" variant="ghost" size="xs" onClick={cancelar} disabled={pendente}>
              Cancelar
            </Button>
            <Button type="button" size="xs" onClick={salvar} disabled={pendente}>
              Salvar
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          data-testid="descricao-texto"
          onClick={abrir}
          className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left text-sm break-words whitespace-pre-wrap outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {atual ? <span className="text-foreground">{atual}</span> : <span className="text-fg-faint">Sem descrição — clique para adicionar</span>}
        </button>
      )}
      <MensagemErro falha={erro} className="mt-1" />
    </section>
  );
}
