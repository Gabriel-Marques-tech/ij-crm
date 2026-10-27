"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/kanban/avatar";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { diaBR } from "@/lib/calendario/rotulos";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { concluirPrazoAction } from "../../_calendario/actions";
import { BotaoNovoPrazo, useEditorPrazo } from "../../_calendario/editor-prazo";

/** Bloco "Prazos" do card (GAB-51): lista, adiciona e conclui os prazos deste card. */
export function PrazosDoCard({ cardId, prazos, hoje }: { cardId: string; prazos: PrazoItem[]; hoje: string }) {
  const { abrir } = useEditorPrazo();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Prazos <span className="font-mono text-xs text-fg-mute tabular">{prazos.length}</span>
        </h2>
        <BotaoNovoPrazo dia={hoje} cardId={cardId} rotulo="Adicionar prazo" variant="outline" />
      </div>
      {prazos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-fg-mute">Nenhum prazo neste card. 🏁 Um prazo aparece como linha de chegada no Calendário.</p>
      ) : (
        <ul className="divide-y divide-border">
          {prazos.map((p) => (
            <li key={p.id} data-estado={p.estado} className="flex items-center gap-3 py-2">
              <button
                type="button"
                disabled={!p.podeMexer || pendente}
                onClick={() =>
                  startTransition(async () => {
                    setErro(await executarAcao(() => concluirPrazoAction(p.id, p.estado !== "feito"), p.estado === "feito" ? "reabrir o prazo" : "concluir o prazo"));
                  })
                }
                aria-label={p.estado === "feito" ? `Reabrir ${p.titulo}` : `Concluir ${p.titulo}`}
                title={p.podeMexer ? undefined : "Só o responsável ou a gestão"}
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  p.estado === "feito" ? "border-border bg-surface-strong text-fg-soft" : p.estado === "vencido" ? "border-primary/60 hover:bg-primary-soft/40" : "border-border-strong hover:bg-surface-hover",
                )}
              >
                {p.estado === "feito" ? <Check className="size-3" aria-hidden /> : null}
              </button>
              <button type="button" onClick={() => abrir(p)} className="min-w-0 flex-1 text-left">
                <span className={cn("block truncate text-sm", p.estado === "feito" ? "text-fg-faint line-through" : p.estado === "vencido" ? "text-primary" : "text-foreground")}>
                  🏁 {p.titulo}
                </span>
              </button>
              <span className={cn("shrink-0 font-mono text-xs tabular", p.estado === "vencido" ? "text-primary" : "text-fg-mute")}>
                {diaBR(p.dia)}
                {p.estado === "vencido" ? " · vencido" : ""}
              </span>
              <Avatar nome={p.responsavel.nome} usuarioId={p.responsavel.id} fotoEm={p.responsavel.fotoEm} />
            </li>
          ))}
        </ul>
      )}
      <MensagemErro falha={erro} className="mt-2" />
    </section>
  );
}
