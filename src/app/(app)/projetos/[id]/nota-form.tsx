"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { adicionarNotaAction } from "../../kanban/actions";

export function NotaForm({ cardId }: { cardId: string }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    startTransition(async () => {
      // Em falha o texto continua no campo para tentar de novo.
      const falha = await executarAcao(() => adicionarNotaAction(cardId, texto), "registrar a nota");
      if (falha) setErro(falha);
      else {
        setErro(null);
        setTexto("");
      }
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-2">
      <label htmlFor="nova-nota" className="sr-only">
        Nova nota
      </label>
      <textarea
        id="nova-nota"
        rows={3}
        value={texto}
        maxLength={5000}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(e);
        }}
        placeholder="Escreva uma nota (Ctrl+Enter envia)"
        className="w-full resize-y rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-fg-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <MensagemErro falha={erro} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pendente || !texto.trim()}>
          Adicionar nota
        </Button>
      </div>
    </form>
  );
}
