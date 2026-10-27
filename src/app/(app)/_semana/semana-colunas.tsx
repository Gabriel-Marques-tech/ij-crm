"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AcaoItem } from "@/lib/calendario/calendario";
import type { DiaAgrupado } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { GradeSemana } from "../_calendario/grade-semana";
import { MarcarFeita } from "./marcar-feita";

/** "✓" no mini-card: marcar feita num diálogo (a coluna é estreita demais para o formulário inline). */
function MarcarFeitaNoCard({ a, hoje }: { a: AcaoItem; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Marcar feita: ${a.acao ?? a.titulo}`}
        title="Marcar feita"
        className="inline-flex size-5 items-center justify-center rounded-md border border-border-strong text-fg-mute transition-colors hover:bg-surface-strong hover:text-foreground"
      >
        <Check className="size-3" aria-hidden />
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="line-clamp-2">{a.acao ?? "Próxima ação"}</DialogTitle>
            <p className="truncate text-xs text-fg-mute">{a.titulo}</p>
          </DialogHeader>
          {aberto ? <MarcarFeita cardId={a.cardId} esperado={{ proximaAcao: a.acao, dia: a.dia }} hoje={hoje} inicialAberto onFechar={() => setAberto(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Minha Semana em colunas (GAB-51, opção A): mesma grade do Calendário, empilhada no celular, com "marcar feita". */
export function SemanaEmColunas({ dias, hoje }: { dias: DiaAgrupado<AcaoItem, PrazoItem>[]; hoje: string }) {
  return <GradeSemana dias={dias} hoje={hoje} layout="empilhar" extraDaAcao={(a) => <MarcarFeitaNoCard a={a} hoje={hoje} />} />;
}
