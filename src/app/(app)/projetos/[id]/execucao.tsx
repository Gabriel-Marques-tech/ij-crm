"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StatusCheckin } from "@prisma/client";
import { StatusCheckinBadge } from "@/components/projetos/status-checkin";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";
import type { VisaoCronograma, VisaoEntrega } from "@/lib/projetos/execucao";
import { MOTIVO_MAX, ROTULO_CHECKIN, STATUS_CHECKIN } from "@/lib/projetos/execucao-regras";
import { formatarDataHora, formatarDia, formatarDinheiro } from "@/lib/projetos/formatar";
import { designarGpAction } from "./handoff-actions";
import { adicionarEntregaAction, ajustarDataAction, cancelarEntregaAction, copiarCronogramaAction, desmarcarEntregaAction, marcarEntregaAction, registrarCheckinAction } from "./execucao-actions";

type Props = {
  cardId: string;
  cronograma: VisaoCronograma;
  /** `AAAA-MM-DD` em São Paulo, vindo do servidor. */
  hoje: string;
  podeOperar: boolean;
  /** É o PM de projetos: pode trocar o GP do projeto, também em Execução. */
  podeDesignar: boolean;
  candidatosGp: { id: string; nome: string }[];
};

type Agir = (chamar: () => Promise<RespostaAcao>, acao: string, depois?: () => void) => void;

const CAMPO = "rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function LinhaDaEntrega({ cardId, e, hoje, podeOperar, pendente, agir }: { cardId: string; e: VisaoEntrega; hoje: string; podeOperar: boolean; pendente: boolean; agir: Agir }) {
  const [aberto, setAberto] = useState<null | "feita" | "ajuste" | "cancelar">(null);
  const [diaReal, setDiaReal] = useState(hoje);
  const [novoDia, setNovoDia] = useState(e.previsto);
  const [motivo, setMotivo] = useState("");
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const fechar = () => setAberto(null);

  return (
    <li className="border-t border-border py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="min-w-0 flex-1 break-words">
          {e.titulo}
          {e.valor ? <span className="ml-2 font-mono text-xs text-fg-mute">{formatarDinheiro(e.valor)}</span> : null}
          {e.origem === "MANUAL" ? <span className="ml-2 font-mono text-[10px] text-fg-mute uppercase">manual</span> : null}
        </span>
        <span className="font-mono text-xs text-fg-soft">
          previsto {formatarDia(e.previsto)}
          {e.previsto !== e.previstoOriginal ? <span className="text-fg-mute"> (original {formatarDia(e.previstoOriginal)})</span> : null}
        </span>
        {e.realizado ? (
          <span className="font-mono text-xs text-success">feita em {formatarDia(e.realizado)}</span>
        ) : e.atrasada ? (
          <span className="font-mono text-xs text-danger">atrasada</span>
        ) : (
          <span className="font-mono text-xs text-fg-mute">pendente</span>
        )}
        {podeOperar ? (
          <span className="flex gap-1">
            {e.realizado ? (
              <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => agir(() => desmarcarEntregaAction(cardId, e.id), "desmarcar a entrega")}>
                Desmarcar
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => setAberto(aberto === "feita" ? null : "feita")}>
                  Marcar feita
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={() => setAberto(aberto === "ajuste" ? null : "ajuste")}>
                  Ajustar data
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={() => setAberto(aberto === "cancelar" ? null : "cancelar")}>
                  Cancelar
                </Button>
              </>
            )}
          </span>
        ) : null}
      </div>
      {aberto === "feita" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="date" aria-label={`Data real de ${e.titulo}`} value={diaReal} max={hoje} onChange={(v) => setDiaReal(v.target.value)} className={CAMPO} />
          <Button type="button" size="sm" disabled={pendente || !diaReal} onClick={() => agir(() => marcarEntregaAction(cardId, e.id, diaReal), "marcar a entrega", fechar)}>
            Confirmar
          </Button>
        </div>
      ) : null}
      {aberto === "ajuste" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="date" aria-label={`Nova data de ${e.titulo}`} value={novoDia} onChange={(v) => setNovoDia(v.target.value)} className={CAMPO} />
          <input type="text" aria-label={`Motivo do ajuste de ${e.titulo}`} placeholder="Motivo do ajuste" maxLength={MOTIVO_MAX} value={motivo} onChange={(v) => setMotivo(v.target.value)} className={`${CAMPO} min-w-48 flex-1`} />
          <Button
            type="button"
            size="sm"
            disabled={pendente || !novoDia || !motivo.trim()}
            onClick={() =>
              agir(() => ajustarDataAction(cardId, e.id, novoDia, motivo), "ajustar a data", () => {
                setMotivo("");
                fechar();
              })
            }
          >
            Salvar ajuste
          </Button>
        </div>
      ) : null}
      {aberto === "cancelar" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="text" aria-label={`Motivo do cancelamento de ${e.titulo}`} placeholder="Motivo do cancelamento" maxLength={MOTIVO_MAX} value={motivoCancelar} onChange={(v) => setMotivoCancelar(v.target.value)} className={`${CAMPO} min-w-48 flex-1`} />
          <Button type="button" size="sm" disabled={pendente || !motivoCancelar.trim()} onClick={() => agir(() => cancelarEntregaAction(cardId, e.id, motivoCancelar), "cancelar a entrega", fechar)}>
            Confirmar cancelamento
          </Button>
        </div>
      ) : null}
      {e.ajustes.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-fg-mute">
          {e.ajustes.map((a, i) => (
            <li key={i}>
              {formatarDia(a.de)} → {formatarDia(a.para)} · {a.motivo} · {a.por}, {formatarDataHora(a.em)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Bloco "Execução" do Projeto (GAB-95, spec §4.10). As regras são do servidor; aqui só se mostra o que cabe a quem vê. */
export function ExecucaoDoProjeto({ cardId, cronograma: c, hoje, podeOperar, podeDesignar, candidatosGp }: Props) {
  const router = useRouter();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const [status, setStatus] = useState<StatusCheckin | null>(null);
  const [motivo, setMotivo] = useState("");
  const [nova, setNova] = useState({ titulo: "", dia: "", valor: "" });
  const [gpId, setGpId] = useState(c.gp.id);

  const agir: Agir = (chamar, acao, depois) => {
    setErro(null);
    startTransition(async () => {
      const falha = await executarAcao(chamar, acao);
      setErro(falha);
      if (!falha) {
        depois?.();
        router.refresh();
      }
    });
  };

  const ultimo = c.checkins[0] ?? null;
  const feitas = c.entregas.filter((e) => e.realizado).length;

  return (
    <section aria-label="Execução" className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Execução</h2>
        {ultimo ? <StatusCheckinBadge status={ultimo.status} motivo={ultimo.motivo} semana={ultimo.semana} /> : null}
        <span className="font-mono text-[11px] text-fg-mute">GP: {c.gp.nome}{c.gpDesignado ? "" : " (responsável, sem GP designado)"}</span>
        {!c.emExecucao ? <span className="font-mono text-[11px] text-fg-mute uppercase">registro</span> : null}
      </div>

      {c.emExecucao && !podeOperar ? (
        <p className="mt-1 text-xs text-fg-mute">
          Quem opera: {c.gp.nome}, com o gestor de projetos e o admin de apoio. Para trocar, o PM de projetos designa outro GP do projeto neste bloco.
        </p>
      ) : null}
      {c.emExecucao && podeDesignar ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select aria-label="Trocar o GP do projeto" value={gpId} onChange={(v) => setGpId(v.target.value)} disabled={pendente} className={`${CAMPO} max-w-64`}>
            {candidatosGp.some((p) => p.id === c.gp.id) ? null : <option value={c.gp.id}>{c.gp.nome}</option>}
            {candidatosGp.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={pendente || (gpId === c.gp.id && c.gpDesignado && c.responsavelId === c.gp.id)} onClick={() => agir(() => designarGpAction(cardId, gpId), "trocar o GP")}>
            Trocar GP
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-soft">
            Cronograma{c.entregas.length ? ` · ${feitas} de ${c.entregas.length} feitas` : ""}
          </h3>
          {c.entregas.length === 0 ? (
            <p className="text-sm text-fg-mute">Sem entregas ainda.{c.copiaveis > 0 ? ` A proposta final tem ${c.copiaveis}.` : podeOperar ? " Lance à mão abaixo." : ""}</p>
          ) : (
            <ul>
              {c.entregas.map((e) => (
                <LinhaDaEntrega key={e.id} cardId={cardId} e={e} hoje={hoje} podeOperar={podeOperar} pendente={pendente} agir={agir} />
              ))}
            </ul>
          )}
          {c.canceladas.length > 0 ? (
            <details className="mt-2 text-xs text-fg-mute">
              <summary>{c.canceladas.length === 1 ? "1 cancelada" : `${c.canceladas.length} canceladas`}</summary>
              <ul className="mt-1 space-y-0.5">
                {c.canceladas.map((k) => (
                  <li key={k.id}>
                    <s>{k.titulo}</s> · {k.motivo} · {formatarDataHora(k.em)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {podeOperar && c.copiaveis > 0 ? (
            <Button type="button" variant="outline" size="sm" className="mt-2" disabled={pendente} onClick={() => agir(() => copiarCronogramaAction(cardId), "copiar o cronograma")}>
              Copiar da proposta final
            </Button>
          ) : null}
          {podeOperar ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <input type="text" aria-label="Nome da nova entrega" placeholder="Nova entrega" value={nova.titulo} onChange={(v) => setNova({ ...nova, titulo: v.target.value })} className={`${CAMPO} min-w-40 flex-1`} />
              <input type="date" aria-label="Data prevista da nova entrega" value={nova.dia} onChange={(v) => setNova({ ...nova, dia: v.target.value })} className={CAMPO} />
              <input type="text" aria-label="Valor da nova entrega" placeholder="Valor (opcional)" inputMode="decimal" value={nova.valor} onChange={(v) => setNova({ ...nova, valor: v.target.value })} className={`${CAMPO} w-36`} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendente || !nova.titulo.trim() || !nova.dia}
                onClick={() => agir(() => adicionarEntregaAction(cardId, nova), "lançar a entrega", () => setNova({ titulo: "", dia: "", valor: "" }))}
              >
                Lançar
              </Button>
            </div>
          ) : null}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-soft">Check-in semanal</h3>
          {podeOperar ? (
            <div className="space-y-2">
              {!c.checkinNaSemana ? <p className="text-xs text-fg-mute">Ainda sem check-in nesta semana.</p> : null}
              <div role="group" aria-label="Status do check-in" className="flex gap-1">
                {STATUS_CHECKIN.map((s) => (
                  <Button key={s} type="button" variant={status === s ? "default" : "outline"} size="sm" aria-pressed={status === s} disabled={pendente} onClick={() => setStatus(s)}>
                    {ROTULO_CHECKIN[s]}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <input type="text" aria-label="Motivo do check-in" placeholder="Uma linha de motivo" maxLength={MOTIVO_MAX} value={motivo} onChange={(v) => setMotivo(v.target.value)} className={`${CAMPO} min-w-40 flex-1`} />
                <Button
                  type="button"
                  size="sm"
                  disabled={pendente || !status || !motivo.trim()}
                  onClick={() =>
                    agir(() => registrarCheckinAction(cardId, status!, motivo), "registrar o check-in", () => {
                      setStatus(null);
                      setMotivo("");
                    })
                  }
                >
                  Registrar
                </Button>
              </div>
            </div>
          ) : null}
          {c.checkins.length === 0 ? (
            <p className="text-sm text-fg-mute">Nenhum check-in ainda.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {c.checkins.map((k) => (
                <li key={k.id} className="flex flex-wrap items-baseline gap-x-2">
                  <StatusCheckinBadge status={k.status} semana={k.semana} />
                  <span className="min-w-0 break-words">{k.motivo}</span>
                  <span className="font-mono text-[11px] text-fg-mute">
                    {k.por}, {formatarDataHora(k.em)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <MensagemErro falha={erro} className="mt-3" />
    </section>
  );
}
