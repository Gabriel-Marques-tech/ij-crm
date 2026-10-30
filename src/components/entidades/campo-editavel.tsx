"use client";

import { useState, useTransition } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { useSomenteLeitura } from "@/components/shell/somente-leitura";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";

const CAMPO_CLASSE =
  "w-full rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Campo editável inline de Empresa/Contato (mesmo comportamento do
 * `CampoInline` do card): clique edita; Enter/blur salva; Esc cancela.
 * `salvar` é uma server action já ligada ao registro e ao campo (`.bind`).
 * VISUALIZADOR (`useSomenteLeitura`): só mostra o valor.
 */
export function CampoEditavel({
  id,
  rotulo,
  valor,
  exibicao,
  salvar,
  tipo = "texto",
  opcoes,
  mono,
  placeholder = "adicionar",
  className,
}: {
  id: string;
  rotulo: string;
  valor: string;
  exibicao?: string;
  salvar: (bruto: string) => Promise<RespostaAcao>;
  tipo?: "texto" | "textarea" | "select";
  opcoes?: { valor: string; rotulo: string }[];
  mono?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const somenteLeitura = useSomenteLeitura();

  function gravar(novo: string) {
    if (novo === valor) {
      setEditando(false);
      setErro(null);
      return;
    }
    startTransition(async () => {
      const falha = await executarAcao(() => salvar(novo), `salvar ${rotulo.toLowerCase()}`);
      if (falha) setErro(falha);
      else {
        setErro(null);
        setEditando(false);
      }
    });
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setRascunho(valor);
      setErro(null);
      setEditando(false);
    } else if (e.key === "Enter" && (tipo !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      gravar(rascunho);
    }
  }

  let controle: React.ReactNode;
  if (tipo === "select") {
    controle = (
      <select id={id} value={valor} disabled={pendente || somenteLeitura} onChange={(e) => gravar(e.target.value)} className={cn(CAMPO_CLASSE, "h-8 py-0")}>
        {opcoes?.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    );
  } else if (somenteLeitura) {
    controle = (
      <p id={id} className={cn("py-1 text-sm whitespace-pre-wrap", valor === "" ? "text-fg-faint" : "text-foreground", mono && "font-mono tabular")}>
        {valor === "" ? "—" : (exibicao ?? valor)}
      </p>
    );
  } else if (!editando) {
    controle = (
      <button
        id={id}
        type="button"
        onClick={() => {
          setRascunho(valor);
          setEditando(true);
        }}
        className={cn(
          "-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left text-sm whitespace-pre-wrap outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50",
          valor === "" ? "text-fg-faint" : "text-foreground",
          mono && "font-mono tabular",
        )}
      >
        {valor === "" ? placeholder : (exibicao ?? valor)}
      </button>
    );
  } else if (tipo === "textarea") {
    controle = (
      <textarea
        id={id}
        autoFocus
        rows={4}
        value={rascunho}
        disabled={pendente}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => gravar(rascunho)}
        onKeyDown={teclas}
        className={cn(CAMPO_CLASSE, "resize-y")}
      />
    );
  } else {
    controle = (
      <Input
        id={id}
        autoFocus
        value={rascunho}
        disabled={pendente}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => gravar(rascunho)}
        onKeyDown={teclas}
      />
    );
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="eyebrow mb-1 block">
        {rotulo}
      </label>
      {controle}
      <MensagemErro falha={erro} className="mt-1" />
    </div>
  );
}
