"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FaseComUso, PipelineParaGestao } from "@/lib/fases/fases";
import { desarquivarFaseAction, moverFaseAction } from "./actions";
import { FaseForm } from "./fase-form";
import { destinoCompativel } from "@/lib/fases/regras";
import { RemoverForm } from "./remover-form";

type Edicao = { modo: "criar" } | { modo: "editar"; fase: FaseComUso } | null;

export function QuadroFases({ pipeline }: { pipeline: PipelineParaGestao }) {
  const ativas = pipeline.fases.filter((f) => f.arquivadaEm === null);
  const arquivadas = pipeline.fases.filter((f) => f.arquivadaEm !== null);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [removendo, setRemovendo] = useState<FaseComUso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function mover(f: FaseComUso, direcao: "SUBIR" | "DESCER") {
    setErro(null);
    startTransition(async () => {
      const r = await moverFaseAction(f.id, direcao);
      if (r?.erro) setErro(r.erro);
    });
  }

  function restaurar(f: FaseComUso) {
    setErro(null);
    startTransition(async () => {
      const r = await desarquivarFaseAction(f.id);
      if (r?.erro) setErro(r.erro);
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="eyebrow">{pipeline.chave}</p>
          <h2 className="text-lg font-semibold">{pipeline.nome}</h2>
        </div>
        <Button size="sm" onClick={() => setEdicao({ modo: "criar" })}>
          <Plus className="h-4 w-4" />
          Nova fase
        </Button>
      </header>

      {erro ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-sm text-danger">
          {erro}
        </p>
      ) : null}

      <ol>
        {ativas.map((f, i) => (
          <li key={f.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
            <span className="font-mono text-xs text-fg-faint tabular">{String(i + 1).padStart(2, "0")}</span>
            <CorDaFase cor={f.cor} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{f.nome}</span>
                {f.tipoTerminal === "GANHO" ? (
                  <Badge variant="outline" className="border-success/50 text-success">
                    ganho
                  </Badge>
                ) : null}
                {f.tipoTerminal === "PERDIDO" ? (
                  <Badge variant="outline" className="border-border-strong text-fg-mute">
                    perdido
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-xs text-fg-faint">
                <span>{f.chave}</span>
                {f.limiteDiasAlerta !== null ? <span className="text-fg-mute">alerta ≥ {f.limiteDiasAlerta}d</span> : null}
                <span>{f.uso.cards === 1 ? "1 card" : `${f.uso.cards} cards`}</span>
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <Button variant="ghost" size="icon-sm" aria-label="Subir" title="Subir" disabled={pendente || i === 0} onClick={() => mover(f, "SUBIR")}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Descer" title="Descer" disabled={pendente || i === ativas.length - 1} onClick={() => mover(f, "DESCER")}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Editar" title="Editar" onClick={() => setEdicao({ modo: "editar", fase: f })}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={f.uso.cards > 0 || f.uso.transicoes > 0 ? "Arquivar" : "Excluir"}
                title={f.uso.cards > 0 || f.uso.transicoes > 0 ? "Arquivar" : "Excluir"}
                className="text-fg-mute hover:text-danger"
                onClick={() => setRemovendo(f)}
              >
                {f.uso.cards > 0 || f.uso.transicoes > 0 ? <Archive /> : <Trash2 />}
              </Button>
            </div>
          </li>
        ))}
        {ativas.length === 0 ? <li className="px-4 py-8 text-center text-sm text-fg-faint">Nenhuma fase ativa.</li> : null}
      </ol>

      {arquivadas.length > 0 ? (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-2 font-mono text-xs text-fg-mute select-none">
            {arquivadas.length === 1 ? "1 fase arquivada" : `${arquivadas.length} fases arquivadas`}
          </summary>
          <ul className="bg-muted/40">
            {arquivadas.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-t border-border px-4 py-2 opacity-70">
                <CorDaFase cor={f.cor} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm">{f.nome}</span>
                  <span className="ml-2 font-mono text-xs text-fg-faint">{f.chave}</span>
                </div>
                <Button variant="ghost" size="sm" disabled={pendente} onClick={() => restaurar(f)}>
                  <ArchiveRestore />
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Dialog open={edicao !== null} onOpenChange={(o) => !o && setEdicao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edicao?.modo === "editar" ? `Editar ${edicao.fase.nome}` : `Nova fase em ${pipeline.nome}`}</DialogTitle>
            <DialogDescription>
              {edicao?.modo === "editar"
                ? "A chave é fixa: regras do sistema a referenciam, nunca a posição."
                : "A chave é derivada do nome e não muda depois. A fase entra no fim do quadro."}
            </DialogDescription>
          </DialogHeader>
          {edicao ? (
            <FaseForm
              pipelineId={pipeline.id}
              fase={edicao.modo === "editar" ? edicao.fase : null}
              onSalvo={() => setEdicao(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={removendo !== null} onOpenChange={(o) => !o && setRemovendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover {removendo?.nome}</DialogTitle>
          </DialogHeader>
          {removendo ? (
            <RemoverForm fase={removendo} destinos={ativas.filter((f) => f.id !== removendo.id && destinoCompativel(removendo, f))} onFeito={() => setRemovendo(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Cor da fase é dado de domínio (configurável pelo gestor), por isso vai inline. */
export function CorDaFase({ cor, className = "" }: { cor: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 shrink-0 rounded-full ${cor ? "" : "bg-border-strong"} ${className}`}
      style={cor ? { backgroundColor: cor } : undefined}
    />
  );
}
