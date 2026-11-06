import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import { CalendarDays, CheckCheck } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import type { Exibicao } from "@/lib/tarefas/exibicao";
import { ROTULO_PRIORIDADE, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";

/** Cor de cada status (só em ícone, nunca fundo cheio; paleta de gráficos da IJ). */
const COR_STATUS: Record<StatusTarefa, string> = {
  BACKLOG: "text-fg-faint",
  A_FAZER: "text-fg-soft",
  EM_ANDAMENTO: "text-chart-3",
  EM_REVISAO: "text-chart-4",
  FEITA: "text-success",
  CANCELADA: "text-fg-faint",
};

/** Círculo que enche conforme o status (Backlog tracejado; Feita cheio com check; Cancelada com X). */
export function IconeStatus({ status, className }: { status: StatusTarefa; className?: string }) {
  const c = cn("shrink-0", COR_STATUS[status], className);
  switch (status) {
    case "BACKLOG":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" /></svg>;
    case "A_FAZER":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
    case "EM_ANDAMENTO":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /></svg>;
    case "EM_REVISAO":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2a6 6 0 1 1-6 6h6z" fill="currentColor" /></svg>;
    case "FEITA":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6.5" fill="currentColor" /><path d="m5.5 8 1.8 1.8L10.8 6" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "CANCELADA":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  }
}

/** Barras de 1 a 3 (baixa, média, alta), quadrado coral para urgente, traços para sem prioridade. */
export function IconePrioridade({ prioridade, className }: { prioridade: PrioridadeTarefa; className?: string }) {
  const c = cn("shrink-0", className);
  const titulo = ROTULO_PRIORIDADE[prioridade];
  if (prioridade === "SEM_PRIORIDADE") return <svg viewBox="0 0 16 16" role="img" aria-label={titulo} className={cn(c, "text-fg-faint")}><path d="M3 8h2M7 8h2M11 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (prioridade === "URGENTE") return <svg viewBox="0 0 16 16" role="img" aria-label={titulo} className={cn(c, "text-primary")}><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" /><path d="M8 4.5v4M8 11v.5" stroke="var(--primary-foreground)" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  const n = { BAIXA: 1, MEDIA: 2, ALTA: 3 }[prioridade];
  const barra = (i: number) => (i <= n ? "text-fg-soft" : "text-border-strong");
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={titulo} className={c}>
      <rect x="2" y="9" width="3" height="5" rx=".5" fill="currentColor" className={barra(1)} />
      <rect x="6.5" y="6" width="3" height="8" rx=".5" fill="currentColor" className={barra(2)} />
      <rect x="11" y="2" width="3" height="12" rx=".5" fill="currentColor" className={barra(3)} />
    </svg>
  );
}

/** Cor estável por nome da etiqueta (paleta de gráficos da IJ), sem tela de administração. */
const CORES_ETIQUETA = ["#ff4d3a", "#ff8655", "#ffc857", "#4cc9f0", "#8a5cf6", "#25d097", "#f042b6"];
export function corEtiqueta(nome: string): string {
  let h = 7;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_ETIQUETA[h % CORES_ETIQUETA.length];
}

export type EstadoPrazo = "atrasada" | "hoje" | "futura";

/** Compara dias civis (`YYYY-MM-DD`), como `estadoProximaAcao`. */
export function estadoPrazo(prazo: string, hoje: string): EstadoPrazo {
  return prazo < hoje ? "atrasada" : prazo === hoje ? "hoje" : "futura";
}

/** `2026-11-10` → `10 nov`. */
export function diaCurto(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d} ${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}`;
}

/** Chip de propriedade (medidas do Linear: 28px, 13px, raio 8, borda branca a 10%). */
export function Chip({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[13px] text-fg-soft", className)}>{children}</span>;
}

export function ChipPrazo({ prazo, hoje, fechada = false, className }: { prazo: string; hoje: string; /** Tarefa feita/cancelada: o prazo vira só informação. */ fechada?: boolean; className?: string }) {
  const estado = fechada ? "futura" : estadoPrazo(prazo, hoje);
  return (
    <Chip className={cn(estado === "atrasada" && "text-danger", className)}>
      <CalendarDays className={cn("size-[15px]", estado === "atrasada" ? "text-danger" : estado === "hoje" ? "text-warn" : "text-fg-mute")} />
      {diaCurto(prazo)}
      {estado === "atrasada" ? " · atrasada" : estado === "hoje" ? " · hoje" : ""}
    </Chip>
  );
}

export function ChipEtiqueta({ nome, className }: { nome: string; className?: string }) {
  return (
    <Chip className={className}>
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: corEtiqueta(nome) }} />
      {nome}
    </Chip>
  );
}

const PADDING: Record<Exibicao["dens"], string> = { compacta: "p-2", padrao: "p-3", confortavel: "p-4" };

/**
 * Cartão da tarefa, nas proporções do card do Linear: linha do ID (13px) com
 * avatar de 20px; título 14/20 com o ícone de status de 16px; chips de 28px;
 * "criada em" 13px; vãos de 8, 10 e 12. Cada parte obedece às propriedades da
 * Exibição. Sem borda lateral colorida.
 */
export function CartaoTarefa({
  tarefa,
  pai,
  pessoa,
  subtarefas,
  mostrarAvatar,
  props,
  dens = "padrao",
  hoje,
  arrastando = false,
}: {
  tarefa: TarefaLista;
  /** Tarefa pai (contexto na primeira linha), quando é subtarefa. */
  pai?: { numero: number; titulo: string } | null;
  pessoa?: PessoaTarefa | null;
  /** Progresso das subtarefas (feitas/total) quando há. */
  subtarefas?: { feitas: number; total: number } | null;
  /** Agrupado por responsável a linha já diz quem é; aí o avatar sai do card. */
  mostrarAvatar: boolean;
  props: Exibicao["props"];
  dens?: Exibicao["dens"];
  hoje: string;
  arrastando?: boolean;
}) {
  const topo = props.id || (props.pai && pai) || (mostrarAvatar && props.resp && pessoa);
  const chips = (props.prio && tarefa.prioridade !== "SEM_PRIORIDADE") || (props.etiquetas && tarefa.etiquetas.length > 0) || (props.prazo && tarefa.prazo) || (props.sub && subtarefas);
  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-surface transition-colors hover:bg-surface-hover",
        PADDING[dens],
        arrastando && "rotate-1 border-border-strong shadow-lg shadow-black/40",
        (tarefa.status === "FEITA" || tarefa.status === "CANCELADA") && "[&_h3]:text-fg-soft",
      )}
    >
      {topo ? (
        <div className="flex h-5 items-center gap-1.5 text-[13px] text-fg-mute">
          {props.id ? <span className="shrink-0">#{tarefa.numero}</span> : null}
          {props.pai && pai ? (
            <span className="min-w-0 truncate text-fg-faint">
              <span aria-hidden>› </span>
              {pai.titulo}
            </span>
          ) : null}
          <span className="flex-1" />
          {mostrarAvatar && props.resp && pessoa ? <Avatar nome={pessoa.nome} usuarioId={pessoa.id} fotoEm={pessoa.fotoEm} className="size-5 text-[9px]" /> : null}
        </div>
      ) : null}
      <h3 className={cn("flex items-start gap-2.5 text-sm leading-5 font-medium text-foreground", topo && "mt-2")}>
        {props.status ? <IconeStatus status={tarefa.status} className="mt-0.5 size-4" /> : null}
        <span className="min-w-0 break-words">{tarefa.titulo}</span>
      </h3>
      {chips ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.prio && tarefa.prioridade !== "SEM_PRIORIDADE" ? (
            <Chip className="w-7 justify-center px-0" title={ROTULO_PRIORIDADE[tarefa.prioridade]}>
              <IconePrioridade prioridade={tarefa.prioridade} className="size-[15px]" />
            </Chip>
          ) : null}
          {props.etiquetas ? tarefa.etiquetas.map((e) => <ChipEtiqueta key={e} nome={e} />) : null}
          {props.prazo && tarefa.prazo ? <ChipPrazo prazo={tarefa.prazo} hoje={hoje} fechada={tarefa.status === "FEITA" || tarefa.status === "CANCELADA"} /> : null}
          {props.sub && subtarefas ? (
            <Chip title="Subtarefas feitas">
              <CheckCheck className="size-[15px] text-fg-mute" />
              {subtarefas.feitas}/{subtarefas.total}
            </Chip>
          ) : null}
        </div>
      ) : null}
      {props.criada ? <p className="mt-3 text-[13px] text-fg-faint">Criada {diaCurto(new Date(tarefa.criadoEmMs).toISOString().slice(0, 10))}</p> : null}
    </article>
  );
}
