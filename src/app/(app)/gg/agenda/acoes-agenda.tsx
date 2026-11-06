"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import type { Opcao } from "@/components/gg/acoes-ocupacao";
import { CAMPO } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { criarEventoAction, registrarAusenciaAction } from "../actions";

/** Célula do dia; para quem edita, clicar abre "novo evento". */
export function DiaAgenda({ dia, numero, hoje, editor, areas, children }: { dia: string; numero: number; hoje: boolean; editor: boolean; areas: Opcao[]; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  const classe = cn("grid min-h-24 content-start gap-1 rounded-lg border bg-surface p-1.5 text-left", hoje ? "border-primary" : "border-border", editor && "hover:border-border-strong");
  const corpo = (
    <>
      <span className={cn("text-xs font-semibold", hoje && "text-primary")}>{numero}</span>
      {children}
    </>
  );
  if (!editor) return <div className={classe}>{corpo}</div>;
  return (
    <>
      <button type="button" className={classe} onClick={() => setAberto(true)} aria-label={`Novo evento em ${dia.split("-").reverse().join("/")}`}>
        {corpo}
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rodar(() => criarEventoAction({ titulo: String(f.get("titulo")), data: dia, horario: String(f.get("horario") || "") || null, categoria: String(f.get("categoria")), areaId: String(f.get("areaId") || "") || null }), "criar o evento", () => setAberto(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Novo evento em {dia.split("-").reverse().join("/")}</DialogTitle>
            </DialogHeader>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Nome do evento ou reunião
              <input name="titulo" required maxLength={200} placeholder="Ex.: Reunião de Marketing" className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Tipo
              <select name="categoria" className={CAMPO} defaultValue="REUNIAO">
                <option value="RG">RG</option>
                <option value="REUNIAO">Reunião</option>
                <option value="EVENTO">Evento</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Horário (opcional)
              <input name="horario" type="time" className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Área (vazio = IJ inteira)
              <select name="areaId" className={CAMPO}>
                <option value="">IJ inteira</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </label>
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Criar evento
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RegistrarAusencia({ eventos, membros }: { eventos: Opcao[]; membros: Opcao[] }) {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  return (
    <>
      <Button className="ml-auto" onClick={() => setAberto(true)} disabled={!eventos.length} title={eventos.length ? undefined : "Nenhum evento nos últimos 120 dias para registrar ausência."}>
        Registrar ausência
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rodar(() => registrarAusenciaAction(String(f.get("evento")), String(f.get("membro")), f.get("situacao") === "justificada", String(f.get("obs") ?? "")), "registrar a ausência", () => setAberto(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Registrar ausência</DialogTitle>
              <DialogDescription>Só para eventos que já aconteceram. Não registrar alguém não significa presença confirmada.</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Evento ou reunião
              <select name="evento" required className={CAMPO}>
                {eventos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Quem faltou
              <select name="membro" required className={CAMPO}>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="situacao" value="justificada" defaultChecked /> Justificada
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="situacao" value="nao" /> Não justificada
              </label>
            </fieldset>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Justificativa ou observação (opcional)
              <input name="obs" maxLength={500} className={CAMPO} />
            </label>
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Registrar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
