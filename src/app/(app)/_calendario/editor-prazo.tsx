"use client";

import { createContext, useContext, useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { diaBR } from "@/lib/calendario/rotulos";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { concluirPrazoAction, criarPrazoAction, editarPrazoAction, excluirPrazoAction } from "./actions";

type Pessoa = { id: string; nome: string };

type Alvo = { tipo: "novo"; dia: string; cardId: string | null } | { tipo: "prazo"; prazo: PrazoItem };

type Ctx = { novo: (dia: string, cardId?: string | null) => void; abrir: (p: PrazoItem) => void };

const EditorCtx = createContext<Ctx | null>(null);

export function useEditorPrazo(): Ctx {
  const c = useContext(EditorCtx);
  if (!c) throw new Error("useEditorPrazo fora de <PrazosProvider>");
  return c;
}

/**
 * Editor de prazo (GAB-51): um diálogo por página, aberto pela grade, pela
 * agenda, pelo "+ Prazo" ou pelo bloco Prazos do card. Vendedor só escolhe a
 * si como responsável; gestor/admin escolhe qualquer ativo. O servidor confere
 * tudo de novo (`podeMexerNoPrazo`).
 */
export function PrazosProvider({
  eu,
  gestor,
  responsaveis,
  responsavelPadrao,
  children,
}: {
  eu: Pessoa;
  gestor: boolean;
  /** Usuários ativos. */
  responsaveis: Pessoa[];
  /** Responsável sugerido num prazo novo (gestor vendo a agenda de alguém → essa pessoa). */
  responsavelPadrao: string;
  children: ReactNode;
}) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const ctx: Ctx = {
    novo: (dia, cardId = null) => setAlvo({ tipo: "novo", dia, cardId }),
    abrir: (prazo) => setAlvo({ tipo: "prazo", prazo }),
  };
  return (
    <EditorCtx.Provider value={ctx}>
      {children}
      <Dialog open={alvo !== null} onOpenChange={(aberto) => (aberto ? null : setAlvo(null))}>
        <DialogContent className="sm:max-w-md">
          {alvo ? (
            <Formulario
              key={alvo.tipo === "novo" ? `novo-${alvo.dia}-${alvo.cardId}` : alvo.prazo.id}
              alvo={alvo}
              eu={eu}
              gestor={gestor}
              responsaveis={responsaveis}
              responsavelPadrao={gestor ? responsavelPadrao : eu.id}
              fechar={() => setAlvo(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </EditorCtx.Provider>
  );
}

function Formulario({
  alvo,
  eu,
  gestor,
  responsaveis,
  responsavelPadrao,
  fechar,
}: {
  alvo: Alvo;
  eu: Pessoa;
  gestor: boolean;
  responsaveis: Pessoa[];
  responsavelPadrao: string;
  fechar: () => void;
}) {
  const prazo = alvo.tipo === "prazo" ? alvo.prazo : null;
  const [titulo, setTitulo] = useState(prazo?.titulo ?? "");
  const [dia, setDia] = useState(prazo?.dia ?? (alvo.tipo === "novo" ? alvo.dia : ""));
  const [resp, setResp] = useState(prazo?.responsavel.id ?? responsavelPadrao);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const base = useId();

  function rodar(chamar: () => Promise<{ erro?: string; ok?: boolean; ref?: string } | undefined>, acao: string) {
    startTransition(async () => {
      const falha = await executarAcao(chamar, acao);
      setErro(falha);
      if (!falha) fechar();
    });
  }

  // Responsável atual pode ter ficado inativo: continua na lista para não "sumir".
  const opcoes = prazo && !responsaveis.some((r) => r.id === prazo.responsavel.id) ? [{ id: prazo.responsavel.id, nome: `${prazo.responsavel.nome} (inativo)` }, ...responsaveis] : responsaveis;

  if (prazo && !prazo.podeMexer) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>🏁 {prazo.titulo}</DialogTitle>
          <DialogDescription>
            <span className="font-mono tabular">{diaBR(prazo.dia)}</span> · {prazo.responsavel.nome} · {prazo.estado === "feito" ? "feito" : prazo.estado === "vencido" ? "vencido" : "pendente"}
          </DialogDescription>
        </DialogHeader>
        {prazo.card ? <CardDoPrazo card={prazo.card} /> : null}
        <p className="text-xs text-fg-mute">Só {prazo.responsavel.nome.split(" ")[0]} ou a gestão podem mexer neste prazo.</p>
      </>
    );
  }

  const salvar = () =>
    rodar(
      () => (prazo ? editarPrazoAction(prazo.id, { titulo, dia, responsavelId: resp }) : criarPrazoAction({ titulo, dia, responsavelId: resp, oportunidadeId: alvo.tipo === "novo" ? alvo.cardId : null })),
      prazo ? "salvar o prazo" : "criar o prazo",
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
      className="grid gap-3"
    >
      <DialogHeader>
        <DialogTitle>{prazo ? "Prazo" : "Novo prazo"}</DialogTitle>
        <DialogDescription>Linha de chegada 🏁: um dia, um responsável{alvo.tipo === "novo" && alvo.cardId ? ", neste card" : ""}.</DialogDescription>
      </DialogHeader>
      {prazo?.card ? <CardDoPrazo card={prazo.card} /> : null}
      <div className="grid gap-1.5">
        <label htmlFor={`${base}-titulo`} className="text-xs text-fg-soft">
          Nome
        </label>
        <Input id={`${base}-titulo`} autoFocus value={titulo} maxLength={200} disabled={pendente} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: entregar proposta" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${base}-dia`} className="text-xs text-fg-soft">
            Dia
          </label>
          <Input id={`${base}-dia`} type="date" value={dia} disabled={pendente} onChange={(e) => setDia(e.target.value)} className="font-mono tabular" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${base}-resp`} className="text-xs text-fg-soft">
            Responsável
          </label>
          {gestor ? (
            <select
              id={`${base}-resp`}
              value={resp}
              disabled={pendente}
              onChange={(e) => setResp(e.target.value)}
              className="h-8 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id === eu.id ? `${o.nome} (você)` : o.nome}
                </option>
              ))}
            </select>
          ) : (
            <p id={`${base}-resp`} className="flex h-8 items-center text-sm text-fg-soft">
              {prazo ? prazo.responsavel.nome : `${eu.nome} (você)`}
            </p>
          )}
        </div>
      </div>
      <MensagemErro falha={erro} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pendente || !titulo.trim() || !dia}>
          {prazo ? "Salvar" : (
            <>
              <Plus data-icon="inline-start" /> Criar prazo
            </>
          )}
        </Button>
        {prazo ? (
          <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => rodar(() => concluirPrazoAction(prazo.id, prazo.estado !== "feito"), prazo.estado === "feito" ? "reabrir o prazo" : "concluir o prazo")}>
            {prazo.estado === "feito" ? <RotateCcw data-icon="inline-start" /> : <Check data-icon="inline-start" />}
            {prazo.estado === "feito" ? "Reabrir" : "Concluir"}
          </Button>
        ) : null}
        <span className="flex-1" />
        {prazo ? (
          <Button
            type="button"
            size="sm"
            variant={confirmarExclusao ? "destructive" : "ghost"}
            disabled={pendente}
            onClick={() => (confirmarExclusao ? rodar(() => excluirPrazoAction(prazo.id), "excluir o prazo") : setConfirmarExclusao(true))}
          >
            <Trash2 data-icon="inline-start" />
            {confirmarExclusao ? "Confirmar exclusão" : "Excluir"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function CardDoPrazo({ card }: { card: { id: string; titulo: string } }) {
  return (
    <p className="text-xs text-fg-mute">
      Card:{" "}
      <Link href={`/kanban/${card.id}`} className="text-fg-soft underline decoration-fg-faint underline-offset-2 hover:text-foreground">
        {card.titulo}
      </Link>
    </p>
  );
}

/** "+ Prazo" do cabeçalho: abre o editor no dia sugerido. */
export function BotaoNovoPrazo({ dia, cardId = null, rotulo = "Prazo", variant = "default" }: { dia: string; cardId?: string | null; rotulo?: string; variant?: "default" | "outline" }) {
  const { novo } = useEditorPrazo();
  return (
    <Button type="button" size="sm" variant={variant} onClick={() => novo(dia, cardId)}>
      <Plus data-icon="inline-start" /> {rotulo}
    </Button>
  );
}
