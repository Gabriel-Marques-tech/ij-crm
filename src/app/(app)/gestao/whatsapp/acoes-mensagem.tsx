"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, Wrench } from "lucide-react";
import { BuscaEntidade, type OpcaoBusca } from "@/components/entidades/busca-entidade";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { buscarCardsAction, reprocessarAction, resolverAction } from "./actions";

const SELECT =
  "h-8 w-full rounded-lg border border-input bg-input/30 px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Título sugerido: 1ª linha do texto, sem o #crm, até 80 caracteres. */
function tituloSugerido(texto: string): string {
  const linha = texto.replace(/#crm\b/giu, "").trim().split("\n")[0]?.trim() ?? "";
  return linha.length > 80 ? `${linha.slice(0, 79)}…` : linha;
}

/** Botões da linha da fila: Reprocessar (mesma função do cron) e Resolver manualmente. */
export function AcoesMensagem({ id, texto, fases }: { id: string; texto: string; fases: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; card?: string } | null>(null);
  const [pendente, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);

  function reprocessar() {
    setAviso(null);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof reprocessarAction>> | undefined;
      const falha = await executarAcao(async () => (r = await reprocessarAction(id)), "reprocessar a mensagem");
      setErro(falha);
      if (falha || !r || !("aviso" in r) || !r.aviso) return;
      setAviso({ texto: r.aviso, card: r.projetoId });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={reprocessar}>
          <RotateCcw aria-hidden /> {pendente ? "Reprocessando…" : "Reprocessar"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => setAberto(true)}>
          <Wrench aria-hidden /> Resolver manualmente
        </Button>
      </div>
      {aviso ? (
        <p className="max-w-xs text-right text-xs text-fg-soft" role="status">
          {aviso.texto}{" "}
          {aviso.card ? (
            <Link href={`/projetos/${encodeURIComponent(aviso.card)}`} className="text-primary hover:underline">
              abrir card
            </Link>
          ) : null}
        </p>
      ) : null}
      <MensagemErro falha={erro} className="max-w-xs text-right" />
      {aberto ? <DialogoResolver id={id} texto={texto} fases={fases} onFechar={() => setAberto(false)} /> : null}
    </div>
  );
}

function DialogoResolver({ id, texto, fases, onFechar }: { id: string; texto: string; fases: { id: string; nome: string }[]; onFechar: () => void }) {
  const router = useRouter();
  const idTitulo = useId();
  const idFase = useId();
  const [modo, setModo] = useState<"CRIAR" | "VINCULAR">("CRIAR");
  const [titulo, setTitulo] = useState(() => tituloSugerido(texto));
  const [faseId, setFaseId] = useState(fases[0]?.id ?? "");
  const [card, setCard] = useState<OpcaoBusca | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const pronto = modo === "CRIAR" ? titulo.trim() !== "" && faseId !== "" : card !== null;

  function confirmar() {
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof resolverAction>> | undefined;
      const alvo = modo === "CRIAR" ? { tipo: "CRIAR" as const, titulo, faseId } : { tipo: "VINCULAR" as const, projetoId: card!.id };
      const falha = await executarAcao(async () => (r = await resolverAction(id, alvo)), "resolver a mensagem");
      setErro(falha);
      if (falha || !r || !("projetoId" in r) || !r.projetoId) return;
      onFechar();
      router.push(`/projetos/${encodeURIComponent(r.projetoId)}`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolver manualmente</DialogTitle>
          <DialogDescription>
            Cria um card ou liga a um card existente. A mensagem sai da fila como processada, com o seu nome. Nada é enviado no grupo.
          </DialogDescription>
        </DialogHeader>
        <p className="max-h-40 overflow-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{texto}</p>
        <div className="flex gap-2" role="radiogroup" aria-label="O que fazer">
          {(["CRIAR", "VINCULAR"] as const).map((m) => (
            <Button key={m} type="button" size="sm" variant={modo === m ? "default" : "outline"} role="radio" aria-checked={modo === m} onClick={() => setModo(m)}>
              {m === "CRIAR" ? "Criar card" : "Ligar a card existente"}
            </Button>
          ))}
        </div>
        {modo === "CRIAR" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor={idTitulo} className="text-xs text-fg-mute">
                Título do card
              </label>
              <Input id={idTitulo} value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={idFase} className="text-xs text-fg-mute">
                Fase (Vendas)
              </label>
              <select id={idFase} value={faseId} onChange={(e) => setFaseId(e.target.value)} className={SELECT}>
                {fases.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-fg-mute">Responsável: quem mandou a mensagem (ou você, se a pessoa estiver desativada).</p>
          </div>
        ) : card ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="truncate">
              {card.nome} {card.detalhe ? <span className="text-xs text-fg-mute">· {card.detalhe}</span> : null}
            </span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setCard(null)}>
              trocar
            </Button>
          </div>
        ) : (
          <BuscaEntidade rotulo="Card" placeholder="Buscar card pelo título…" buscar={buscarCardsAction} onEscolher={setCard} autoFocus />
        )}
        <MensagemErro falha={erro} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pendente} onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" disabled={pendente || !pronto} onClick={confirmar}>
            {pendente ? "…" : modo === "CRIAR" ? "Criar e resolver" : "Ligar e resolver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
