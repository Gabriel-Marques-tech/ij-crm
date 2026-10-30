"use client";

import { useId, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DETALHE_PERDA_MAX,
  MOTIVOS_PERDA,
  interpretarGanho,
  interpretarPerda,
  motivoDeTexto,
  valorParaCampo,
  type ChaveMotivoPerda,
  type DadosTerminal,
  type ErroDadosTerminal,
} from "@/lib/projetos/terminal-regras";

/**
 * `tipo` = qual diálogo (ver `dialogoTerminal`): ganho pede valor, perdido pede
 * motivo. `inicial` = último fechamento guardado no card (reabrir mantém os
 * campos): pré-preenche o re-ganho / a re-perda.
 */
export type PedidoTerminal = {
  titulo: string;
  faseNome: string;
  tipo: "GANHO" | "PERDIDO";
  inicial?: { valorFechado: string | null; motivoPerda: string | null };
};

const MENSAGEM: Record<ErroDadosTerminal, string> = {
  DADOS_TERMINAL_OBRIGATORIOS: "Dados inválidos.",
  VALOR_FECHADO_INVALIDO: "Valor inválido. Ex.: 12.500,00",
  MOTIVO_PERDA_OBRIGATORIO: "Escolha um motivo.",
  MOTIVO_PERDA_INVALIDO: "Motivo inválido.",
  MOTIVO_PERDA_DETALHE_OBRIGATORIO: "Descreva o motivo.",
  MOTIVO_PERDA_DETALHE_LONGO: `No máximo ${DETALHE_PERDA_MAX} caracteres.`,
};

/**
 * Diálogo ao mover para ganho (vendas) ou perdido — o mesmo no arrasto do
 * quadro e no seletor de fase do detalhe. Cancelar = não move. Validação aqui
 * é só conforto: o servidor revalida tudo no gancho (`terminal.ts`).
 */
export function DialogoTerminal({
  pedido,
  onConfirmar,
  onCancelar,
}: {
  pedido: PedidoTerminal | null;
  onConfirmar: (dados: DadosTerminal) => void;
  onCancelar: () => void;
}) {
  return (
    <Dialog open={pedido !== null} onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent>
        {/* Monta de novo a cada pedido: formulário sempre começa vazio. */}
        {pedido?.tipo === "GANHO" ? <FormGanho pedido={pedido} onConfirmar={onConfirmar} onCancelar={onCancelar} /> : null}
        {pedido?.tipo === "PERDIDO" ? <FormPerdido pedido={pedido} onConfirmar={onConfirmar} onCancelar={onCancelar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type PropsForm = { pedido: PedidoTerminal; onConfirmar: (dados: DadosTerminal) => void; onCancelar: () => void };

function Rodape({ onCancelar, rotulo }: { onCancelar: () => void; rotulo: string }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancelar}>
        Cancelar
      </Button>
      <Button type="submit">{rotulo}</Button>
    </DialogFooter>
  );
}

function FormGanho({ pedido, onConfirmar, onCancelar }: PropsForm) {
  const [valor, setValor] = useState(() => valorParaCampo(pedido.inicial?.valorFechado ?? null));
  const [erro, setErro] = useState<string | null>(null);
  const idValor = useId();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const r = interpretarGanho({ valorFechado: valor });
    if (!r.ok) return setErro(MENSAGEM[r.erro]);
    onConfirmar({ valorFechado: valor });
  }

  return (
    <form onSubmit={enviar} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Ganho: {pedido.faseNome}</DialogTitle>
        <DialogDescription>
          “{pedido.titulo}” vira ganho (contrato assinado) e o mesmo card segue para Handoff, no quadro Projetos.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={idValor}>Valor fechado (opcional)</Label>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-fg-mute">
            R$
          </span>
          <Input
            id={idValor}
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="12.500,00"
            value={valor}
            maxLength={30}
            onChange={(e) => {
              setValor(e.target.value);
              setErro(null);
            }}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${idValor}-erro` : undefined}
            className="pl-8 font-mono tabular"
          />
        </div>
        {erro ? (
          <p id={`${idValor}-erro`} className="text-xs text-danger">
            {erro}
          </p>
        ) : null}
      </div>
      <Rodape onCancelar={onCancelar} rotulo="Marcar como ganho" />
    </form>
  );
}

function FormPerdido({ pedido, onConfirmar, onCancelar }: PropsForm) {
  const [inicial] = useState(() => motivoDeTexto(pedido.inicial?.motivoPerda ?? null));
  const [motivo, setMotivo] = useState<ChaveMotivoPerda | "">(inicial.motivo);
  const [detalhe, setDetalhe] = useState(inicial.detalhe);
  const [erro, setErro] = useState<string | null>(null);
  const base = useId();
  const outro = motivo === "outro";

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = { motivo, detalhe };
    const r = interpretarPerda(dados);
    if (!r.ok) return setErro(MENSAGEM[r.erro]);
    onConfirmar(dados);
  }

  return (
    <form onSubmit={enviar} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Perdido: {pedido.faseNome}</DialogTitle>
        <DialogDescription>Por que “{pedido.titulo}” foi perdido? Dá para reabrir depois.</DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-1.5" aria-describedby={erro ? `${base}-erro` : undefined}>
        <legend className="mb-1.5 text-sm font-medium">Motivo</legend>
        <div className="flex flex-wrap gap-1.5">
          {MOTIVOS_PERDA.map((m) => (
            <label
              key={m.chave}
              className={cn(
                "cursor-pointer rounded-lg border px-2.5 py-1 text-sm transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                motivo === m.chave ? "border-primary bg-primary-soft text-foreground" : "border-border text-fg-soft hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name={`${base}-motivo`}
                value={m.chave}
                checked={motivo === m.chave}
                onChange={() => {
                  setMotivo(m.chave);
                  setErro(null);
                }}
                className="sr-only"
              />
              {m.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor={`${base}-detalhe`}>{outro ? "Qual foi o motivo?" : "Detalhe (opcional)"}</Label>
        <textarea
          id={`${base}-detalhe`}
          rows={3}
          value={detalhe}
          maxLength={DETALHE_PERDA_MAX}
          onChange={(e) => {
            setDetalhe(e.target.value);
            setErro(null);
          }}
          placeholder={outro ? "Ex.: a empresa fechou a área" : "Ex.: fechou com a concorrente X"}
          className="w-full rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      {erro ? (
        <p id={`${base}-erro`} role="alert" className="-mt-2 text-xs text-danger">
          {erro}
        </p>
      ) : null}
      <Rodape onCancelar={onCancelar} rotulo="Marcar como perdido" />
    </form>
  );
}
