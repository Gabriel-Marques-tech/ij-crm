"use client";

import { useId, useState, useTransition } from "react";
import { Check, CalendarPlus } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { definirProximaAction, marcarFeitaAction, type Esperado } from "./actions";

/**
 * "Marcar feita" inline: abre o campo da próxima ação + data no mesmo lugar.
 * O card só fica sem próxima ação se o usuário clicar em "Deixar sem" — não
 * existe caminho que esvazie sem essa escolha. Modo `definir`: card que já
 * está sem próxima ação ganha uma (sem NOTA de feito).
 */
export function MarcarFeita({
  cardId,
  esperado,
  hoje,
  modo = "feita",
  destaque = false,
  inicialAberto = false,
  onFechar,
}: {
  cardId: string;
  esperado: Esperado;
  /** `YYYY-MM-DD` de hoje em SP (do servidor: o fuso do navegador não manda). */
  hoje: string;
  modo?: "feita" | "definir";
  destaque?: boolean;
  /** Já abre no formulário (dentro de um diálogo, na semana em colunas). */
  inicialAberto?: boolean;
  /** Chamado ao salvar ou cancelar (fecha o diálogo de quem abriu). */
  onFechar?: () => void;
}) {
  const [aberto, setAberto] = useState(inicialAberto);
  const fechar = () => {
    setAberto(false);
    onFechar?.();
  };
  const [acao, setAcao] = useState("");
  const [dia, setDia] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const base = useId();

  function enviar(tipo: "nova" | "nenhuma") {
    startTransition(async () => {
      const falha =
        modo === "definir"
          ? await executarAcao(() => definirProximaAction(cardId, acao, dia), "salvar a próxima ação")
          : await executarAcao(
              () => marcarFeitaAction(cardId, esperado, tipo === "nova" ? { tipo, proximaAcao: acao, dia } : { tipo }),
              "marcar como feita",
            );
      setErro(falha);
      // Sucesso: a página revalida e o card muda de faixa; o formulário some junto.
      if (!falha) fechar();
    });
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        size={destaque ? "default" : "sm"}
        variant={destaque ? "default" : "outline"}
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
      >
        {modo === "feita" ? <Check data-icon="inline-start" /> : <CalendarPlus data-icon="inline-start" />}
        {modo === "feita" ? "Marcar feita" : "Definir próxima"}
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar("nova");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") fechar();
      }}
      className={cn("w-full space-y-2 rounded-lg border border-border-strong bg-surface-strong p-3", destaque && "mt-2")}
      aria-label={modo === "feita" ? "Marcar feita e definir a próxima ação" : "Definir a próxima ação"}
    >
      <p className="text-xs text-fg-soft">{modo === "feita" ? "Feito. Qual é a próxima ação?" : "Qual é a próxima ação?"}</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label htmlFor={`${base}-acao`} className="sr-only">
          Próxima ação
        </label>
        <Input id={`${base}-acao`} autoFocus value={acao} maxLength={500} disabled={pendente} onChange={(e) => setAcao(e.target.value)} placeholder="Ex.: enviar proposta" />
        <label htmlFor={`${base}-dia`} className="sr-only">
          Data da próxima ação
        </label>
        <Input id={`${base}-dia`} type="date" min={hoje} value={dia} disabled={pendente} onChange={(e) => setDia(e.target.value)} className="font-mono tabular" />
      </div>
      <MensagemErro falha={erro} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pendente || !acao.trim() || !dia}>
          {modo === "feita" ? "Salvar próxima" : "Salvar"}
        </Button>
        {modo === "feita" ? (
          <Button type="button" size="sm" variant="ghost" disabled={pendente} onClick={() => enviar("nenhuma")}>
            Deixar sem próxima ação
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" disabled={pendente} onClick={fechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
