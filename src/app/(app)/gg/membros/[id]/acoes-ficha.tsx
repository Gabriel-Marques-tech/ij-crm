"use client";

import { useState } from "react";
import Link from "next/link";
import type { Area, Papel, StatusMembro } from "@prisma/client";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { CAMPO, Chip } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Derivado } from "@/lib/gg/modelo";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { ROTULO_STATUS_MEMBRO, STATUS_MEMBRO } from "@/lib/gg/modelo";
import { aplicarNoCrmAction, convidarParaCrmAction, editarMembroAction, registrarEntradaAction, registrarSaidaAction } from "../../actions";

export function EditarMembro({ membro }: { membro: { id: string; nome: string; email: string | null; status: StatusMembro } }) {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        Editar dados
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {membro.nome}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              rodar(() => editarMembroAction(membro.id, { nome: String(f.get("nome")), email: String(f.get("email") || "") || null, status: String(f.get("status")) }), "salvar o membro", () => setAberto(false));
            }}
          >
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Nome
              <input name="nome" required defaultValue={membro.nome} maxLength={200} className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              E-mail
              <input name="email" type="email" defaultValue={membro.email ?? ""} className={CAMPO} />
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute">
              Status (não encerra posições nem o período na IJ)
              <select name="status" defaultValue={membro.status} className={CAMPO}>
                {STATUS_MEMBRO.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_MEMBRO[s]}
                  </option>
                ))}
              </select>
            </label>
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Salvar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PeriodoIj({ membroId, aberto, hoje }: { membroId: string; aberto: boolean; hoje: string }) {
  const [data, setData] = useState(hoje);
  const [confirmar, setConfirmar] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {confirmar ? (
        <>
          <input type="date" aria-label={aberto ? "Data da saída" : "Data do reingresso"} value={data} max={hoje} onChange={(e) => setData(e.target.value)} className={`${CAMPO} w-36`} />
          <Button size="sm" variant={aberto ? "destructive" : "default"} disabled={pendente} onClick={() => rodar(() => (aberto ? registrarSaidaAction(membroId, data) : registrarEntradaAction(membroId, data)), aberto ? "registrar a saída" : "registrar o reingresso", () => setConfirmar(false))}>
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirmar(true)}>
          {aberto ? "Registrar saída" : "Registrar reingresso"}
        </Button>
      )}
      <MensagemErro falha={erro} className="text-xs" />
    </span>
  );
}

/** Bloco "No CRM": o que o organograma sugere × a conta de hoje. Mudar conta é da gestão. */
export function PonteCrm({
  membroId,
  temEmail,
  conta,
  derivado: d,
  difere,
  podeMudarConta,
  desligado,
}: {
  membroId: string;
  temEmail: boolean;
  conta: { papel: Papel; area: Area | null; gp: boolean; ativo: boolean; conviteAberto: boolean } | null;
  derivado: Derivado;
  difere: boolean;
  podeMudarConta: boolean;
  desligado: { cards: number; tarefas: number } | null;
}) {
  const { pendente, erro, rodar } = useAcao();
  const [link, setLink] = useState<string | null>(null);
  const descrever = (papel: Papel, area: Area | null, gp: boolean) => `papel ${papel} · ${area ? `área ${ROTULO_AREA[area]}` : "sem área"}${gp ? " · GP" : ""}`;
  const sugestao = d.conflito ? `duas áreas (${d.conflito.map((a) => ROTULO_AREA[a]).join(" e ")}): marque a posição principal` : d.papel ? descrever(d.papel, d.area, d.gp) : "sem posição: nada a sugerir";
  return (
    <section className="grid gap-2 rounded-xl border border-primary/35 bg-primary-soft/30 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow text-primary">no crm</span>
        <span className="flex-1" />
        {conta ? <Chip tom="ok">conta ligada{conta.conviteAberto ? " · convite pendente" : ""}</Chip> : temEmail ? <Chip>sem conta</Chip> : <Chip>sem e-mail</Chip>}
        {conta && !conta.ativo ? <Chip tom="perigo">conta desativada</Chip> : null}
      </div>
      <p>
        O organograma sugere: <b>{sugestao}</b>
      </p>
      {conta ? (
        <p className="font-mono text-xs text-fg-mute">
          Hoje no CRM: {descrever(conta.papel, conta.area, conta.gp)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {difere ? <Chip tom="aviso">difere do organograma</Chip> : null}
        {difere && podeMudarConta ? (
          <Button size="sm" disabled={pendente} onClick={() => rodar(() => aplicarNoCrmAction(membroId), "aplicar no CRM")}>
            Aplicar o que o organograma diz
          </Button>
        ) : null}
        {!conta && temEmail && podeMudarConta ? (
          <Button size="sm" disabled={pendente} onClick={() => rodar(() => convidarParaCrmAction(membroId), "convidar para o CRM", (r) => setLink(r && "link" in r ? (r.link ?? null) : null))}>
            Convidar para o CRM
          </Button>
        ) : null}
        {(difere || (!conta && temEmail)) && !podeMudarConta ? <span className="text-xs text-fg-faint">Quem é da gestão aplica na conta.</span> : null}
      </div>
      {link ? (
        <p className="text-xs">
          Link do convite (mostrado uma vez): <code className="select-all break-all font-mono">{link}</code>
        </p>
      ) : null}
      {desligado && conta?.ativo ? (
        <p className="text-xs text-warn">
          Desligado com conta ativa: responsável por {desligado.cards} card(s) e {desligado.tarefas} tarefa(s) abertas. Repasse e desative em{" "}
          <Link href="/gestao/usuarios" className="underline">
            Gestão → Usuários
          </Link>
          .
        </p>
      ) : null}
      <MensagemErro falha={erro} className="text-xs" />
    </section>
  );
}
