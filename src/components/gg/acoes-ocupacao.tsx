"use client";

import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adicionarOcupanteAction, encerrarOcupacaoAction, retirarPorErroAction, tornarPrincipalAction, trocarCargoAction } from "@/app/(app)/gg/actions";
import { CAMPO } from "./ui";
import { useAcao } from "./use-acao";

export type Opcao = { id: string; nome: string };
export type OcupanteMenu = { ocupacaoId: string; nome: string; principal: boolean };

type Modal =
  | { tipo: "adicionar"; posicao: Opcao }
  | { tipo: "trocar" | "encerrar" | "retirar"; ocupante: OcupanteMenu; posicao: Opcao }
  | null;

/**
 * Menu ⋯ de uma posição (organograma) ou de uma ocupação (ficha), como no automacao-GG:
 * ações da posição e de cada ocupante. Abre um diálogo por ação; cada uma explica o efeito.
 */
export function MenuOcupacao({ posicao, ocupantes, posicoes, membros, hoje }: { posicao: Opcao; ocupantes: OcupanteMenu[]; posicoes: Opcao[]; membros?: Opcao[]; hoje: string }) {
  const [modal, setModal] = useState<Modal>(null);
  const detalhes = useRef<HTMLDetailsElement>(null);
  const { pendente, erro, setErro, rodar } = useAcao();
  const abrir = (m: Modal) => {
    detalhes.current?.removeAttribute("open");
    setErro(null);
    setModal(m);
  };
  const fechar = () => setModal(null);

  return (
    <>
      <details
        ref={detalhes}
        className="relative"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !e.currentTarget.open) return;
          e.currentTarget.removeAttribute("open");
          e.currentTarget.querySelector("summary")?.focus();
        }}
        // Fecha ao sair do menu (clique fora ou Tab adiante), como um menu de verdade.
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && e.currentTarget.removeAttribute("open")}
      >
        <summary aria-label={`Ações de ${posicao.nome}`} className="grid size-7 cursor-pointer list-none place-items-center rounded-md text-fg-mute hover:bg-surface-hover hover:text-foreground [&::-webkit-details-marker]:hidden">
          <MoreHorizontal className="size-4" />
        </summary>
        <div role="menu" tabIndex={-1} className="absolute right-0 z-20 mt-1 grid w-60 rounded-lg outline-none border border-border-strong bg-popover p-1 text-left text-sm shadow-lg">
          {membros ? <Item onClick={() => abrir({ tipo: "adicionar", posicao })}>Adicionar ocupante</Item> : null}
          {ocupantes.map((o) => (
            <div key={o.ocupacaoId} className="mt-1 border-t border-border pt-1 first:mt-0 first:border-0 first:pt-0">
              {ocupantes.length > 1 || membros ? <p className="px-2.5 py-1.5 text-xs text-fg-faint">{o.nome}</p> : null}
              <Item onClick={() => abrir({ tipo: "trocar", ocupante: o, posicao })}>Trocar cargo</Item>
              <Item onClick={() => abrir({ tipo: "encerrar", ocupante: o, posicao })}>Encerrar vínculo</Item>
              {!o.principal ? <Item onClick={() => rodar(() => tornarPrincipalAction(o.ocupacaoId), "marcar como principal", () => detalhes.current?.removeAttribute("open"))}>Tornar posição principal</Item> : null}
              <Item perigo onClick={() => abrir({ tipo: "retirar", ocupante: o, posicao })}>
                Retirar por erro
              </Item>
            </div>
          ))}
        </div>
      </details>
      {!modal && erro ? <MensagemErro falha={erro} className="text-xs" /> : null}

      <Dialog open={modal !== null} onOpenChange={(a) => !a && fechar()}>
        <DialogContent>
          {modal?.tipo === "adicionar" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const inicio = f.get("desconhecido") ? null : String(f.get("inicio"));
                rodar(() => adicionarOcupanteAction(modal.posicao.id, String(f.get("membro")), inicio), "adicionar o ocupante", fechar);
              }}
            >
              <DialogHeader>
                <DialogTitle>Adicionar a {modal.posicao.nome}</DialogTitle>
                <DialogDescription>Uma pessoa pode ocupar mais de uma posição; a primeira vira a principal.</DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Membro
                <select name="membro" required className={CAMPO}>
                  {membros!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Início
                <input name="inicio" type="date" defaultValue={hoje} max={hoje} className={CAMPO} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="desconhecido" /> Início desconhecido (fica vazio, nunca vira hoje)
              </label>
              <Rodape pendente={pendente} texto="Adicionar" erro={erro} />
            </form>
          ) : modal?.tipo === "trocar" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const tipo = String(f.get("tipo"));
                rodar(() => trocarCargoAction(modal.ocupante.ocupacaoId, String(f.get("destino")), tipo, tipo === "real" ? String(f.get("data")) : null), "trocar o cargo", fechar);
              }}
            >
              <DialogHeader>
                <DialogTitle>Trocar cargo de {modal.ocupante.nome}</DialogTitle>
                <DialogDescription>Hoje: {modal.posicao.nome}</DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Nova posição
                <select name="destino" className={CAMPO}>
                  {posicoes
                    .filter((p) => p.id !== modal.posicao.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                </select>
              </label>
              <fieldset className="grid gap-2">
                <Opcao nome="tipo" valor="real" padrao titulo="Mudança real" texto="Encerra a posição atual na data e abre a nova. As duas ficam na trajetória." />
                <Opcao nome="tipo" valor="correcao" titulo="Correção de cadastro" texto="A atual foi registrada por engano: sai da trajetória e a nova assume a mesma data de início." />
              </fieldset>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Data efetiva (só na mudança real)
                <input name="data" type="date" defaultValue={hoje} max={hoje} className={CAMPO} />
              </label>
              <Rodape pendente={pendente} texto="Trocar" erro={erro} />
            </form>
          ) : modal?.tipo === "encerrar" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                rodar(() => encerrarOcupacaoAction(modal.ocupante.ocupacaoId, String(new FormData(e.currentTarget).get("fim"))), "encerrar o vínculo", fechar);
              }}
            >
              <DialogHeader>
                <DialogTitle>Encerrar vínculo</DialogTitle>
                <DialogDescription>
                  {modal.ocupante.nome} deixa de ocupar {modal.posicao.nome}. O período continua na trajetória; a data do fim já não conta como dia ocupado. O status da pessoa e o período na IJ não mudam.
                </DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Fim
                <input name="fim" type="date" defaultValue={hoje} max={hoje} className={CAMPO} />
              </label>
              <Rodape pendente={pendente} texto="Encerrar" erro={erro} />
            </form>
          ) : modal?.tipo === "retirar" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                rodar(() => retirarPorErroAction(modal.ocupante.ocupacaoId, String(new FormData(e.currentTarget).get("motivo"))), "retirar a atribuição", fechar);
              }}
            >
              <DialogHeader>
                <DialogTitle>Retirar por erro</DialogTitle>
                <DialogDescription>
                  Para atribuições que nunca aconteceram. {modal.posicao.nome} sai do organograma e da trajetória de {modal.ocupante.nome}, mas fica guardada com data, autor e motivo.
                </DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-xs text-fg-mute">
                Motivo
                <input name="motivo" required maxLength={500} placeholder="Ex.: cadastrada na frente errada" className={CAMPO} />
              </label>
              <Rodape pendente={pendente} texto="Retirar" erro={erro} perigo />
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Item({ children, onClick, perigo }: { children: React.ReactNode; onClick: () => void; perigo?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`block w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-hover ${perigo ? "text-danger" : ""}`}>
      {children}
    </button>
  );
}

function Opcao({ nome, valor, titulo, texto, padrao }: { nome: string; valor: string; titulo: string; texto: string; padrao?: boolean }) {
  return (
    <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-x-2.5 rounded-lg border border-border-strong p-3 has-checked:border-chart-5 has-checked:bg-chart-5/10">
      <input type="radio" name={nome} value={valor} defaultChecked={padrao} className="mt-1" />
      <span>
        <b className="text-sm font-medium">{titulo}</b>
        <span className="block text-xs text-fg-mute">{texto}</span>
      </span>
    </label>
  );
}

function Rodape({ pendente, texto, erro, perigo }: { pendente: boolean; texto: string; erro: Parameters<typeof MensagemErro>[0]["falha"]; perigo?: boolean }) {
  return (
    <>
      <MensagemErro falha={erro} className="text-sm" />
      <Button type="submit" variant={perigo ? "destructive" : "default"} disabled={pendente}>
        {texto}
      </Button>
    </>
  );
}
