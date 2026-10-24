"use client";

import { useState, useTransition } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { CampoEditavel } from "@/lib/oportunidades/campos";
import { editarCampoAction } from "../actions";

export type TipoCampo = "texto" | "textarea" | "url" | "dinheiro" | "data" | "select";

const CAMPO_CLASSE =
  "w-full rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Campo editável inline: mostra o valor; clique (ou Enter) edita; Enter/blur
 * salva, Esc cancela. Cada salvamento vira uma Timeline CAMPO_ALTERADO no servidor.
 */
export function CampoInline({
  cardId,
  campo,
  rotulo,
  valor,
  exibicao,
  tipo = "texto",
  opcoes,
  placeholder = "adicionar",
  className,
}: {
  cardId: string;
  campo: CampoEditavel;
  rotulo: string;
  /** Valor cru para o input (o que o servidor interpreta). */
  valor: string;
  /** Texto formatado para leitura; padrão = `valor`. */
  exibicao?: string;
  tipo?: TipoCampo;
  opcoes?: { valor: string; rotulo: string }[];
  placeholder?: string;
  className?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const idCampo = `campo-${campo}`;

  function salvar(novo: string) {
    if (novo === valor) {
      setEditando(false);
      setErro(null);
      return;
    }
    startTransition(async () => {
      const r = await editarCampoAction(cardId, campo, novo);
      if (r.erro) setErro(r.erro);
      else {
        setErro(null);
        setEditando(false);
      }
    });
  }

  function cancelar() {
    setRascunho(valor);
    setErro(null);
    setEditando(false);
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelar();
    } else if (e.key === "Enter" && (tipo !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      salvar(rascunho);
    }
  }

  let controle: React.ReactNode;
  if (tipo === "select") {
    // Select salva na mudança; sempre visível (mobile-friendly, sem modo leitura).
    controle = (
      <select
        id={idCampo}
        value={valor}
        disabled={pendente}
        onChange={(e) => salvar(e.target.value)}
        className={cn(CAMPO_CLASSE, "h-8 py-0")}
      >
        {opcoes?.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    );
  } else if (!editando) {
    const vazio = valor === "";
    controle = (
      <button
        id={idCampo}
        type="button"
        onClick={() => {
          setRascunho(valor);
          setEditando(true);
        }}
        className={cn(
          "-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left text-sm whitespace-pre-wrap outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50",
          vazio ? "text-fg-faint" : "text-foreground",
          (tipo === "dinheiro" || tipo === "data") && "font-mono tabular",
        )}
      >
        {vazio ? placeholder : (exibicao ?? valor)}
      </button>
    );
  } else if (tipo === "textarea") {
    controle = (
      <textarea
        id={idCampo}
        autoFocus
        rows={4}
        value={rascunho}
        disabled={pendente}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => salvar(rascunho)}
        onKeyDown={teclas}
        className={cn(CAMPO_CLASSE, "resize-y")}
      />
    );
  } else {
    controle = (
      <Input
        id={idCampo}
        autoFocus
        type={tipo === "url" ? "url" : tipo === "data" ? "date" : "text"}
        inputMode={tipo === "dinheiro" ? "decimal" : undefined}
        value={rascunho}
        disabled={pendente}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => salvar(rascunho)}
        onKeyDown={teclas}
        placeholder={tipo === "dinheiro" ? "12.500,00" : tipo === "url" ? "https://" : undefined}
      />
    );
  }

  return (
    <div className={className}>
      <label htmlFor={idCampo} className="eyebrow mb-1 block">
        {rotulo}
      </label>
      {controle}
      {tipo === "url" && !editando && valor ? (
        <a href={valor} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block font-mono text-[11px] text-fg-mute hover:text-foreground hover:underline">
          abrir link ↗
        </a>
      ) : null}
      {erro ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

export function RevisarSwitch({ cardId, valor }: { cardId: string; valor: boolean }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={valor}
          disabled={pendente}
          onCheckedChange={(v) =>
            startTransition(async () => {
              const r = await editarCampoAction(cardId, "revisar", v ? "true" : "false");
              setErro(r.erro ?? null);
            })
          }
        />
        Marcar para revisar
      </label>
      {erro ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
