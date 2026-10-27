import Link from "next/link";
import { ArrowRightLeft, MessageSquareText, Pencil, Plus, Download, MessageCircle, Link2, Trash2, ArchiveRestore, Flag } from "lucide-react";
import type { TipoTimeline } from "@prisma/client";
import { ehCampoEditavel, ROTULO_CAMPO } from "@/lib/oportunidades/campos";
import { ROTULO_CAMPO_TERMINAL, ehCampoTerminal, formatarCampoTerminal, formatarDataHora, formatarDia, formatarValorCampo } from "@/lib/oportunidades/formatar";
import type { DetalheCard } from "@/lib/oportunidades/oportunidades";
import { ehCampoVinculo, ROTULO_VINCULO } from "@/lib/oportunidades/vinculos";
import { MensagemWhatsapp } from "./mensagem-whatsapp";

type Entrada = DetalheCard["timeline"][number];
type Payload = Record<string, unknown>;

const ICONE: Record<TipoTimeline, typeof Plus> = {
  CRIACAO: Plus,
  MOVIMENTACAO: ArrowRightLeft,
  CAMPO_ALTERADO: Pencil,
  NOTA: MessageSquareText,
  MENSAGEM_WHATSAPP: MessageCircle,
  IMPORT: Download,
  VINCULO_PROJETO: Link2,
  EXCLUSAO: Trash2,
  RESTAURACAO: ArchiveRestore,
  PRAZO: Flag,
};

/** Card ligado a este (venda ↔ projeto), para os links da Timeline. */
export type CardRelacionado = { titulo: string; quadro: string };

const VIA: Record<string, string> = { UI: "pelo app", WHATSAPP: "pelo WhatsApp", IMPORT: "pela importação" };

function obj(p: unknown): Payload {
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Payload) : {};
}

function LinkCard({ id, relacionados, rotulo }: { id: unknown; relacionados: ReadonlyMap<string, CardRelacionado>; rotulo: string }) {
  const c = typeof id === "string" ? relacionados.get(id) : undefined;
  if (!c || typeof id !== "string") return <>{rotulo} (removido)</>;
  return (
    <Link href={`/kanban/${id}`} className="font-medium text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
      {c.titulo}
    </Link>
  );
}

function Descricao({
  e,
  fases,
  nomes,
  relacionados,
}: {
  e: Entrada;
  fases: ReadonlyMap<string, string>;
  nomes: ReadonlyMap<string, string>;
  relacionados: ReadonlyMap<string, CardRelacionado>;
}) {
  const p = obj(e.payload);
  const fase = (id: unknown) => (typeof id === "string" ? (fases.get(id) ?? "fase removida") : "—");
  switch (e.tipo) {
    case "CRIACAO":
      if (p.via === "GANHO") {
        return (
          <>
            criou o projeto em <b className="font-medium text-foreground">{fase(p.faseId)}</b> pelo ganho de{" "}
            <LinkCard id={p.origemOportunidadeId} relacionados={relacionados} rotulo="venda" />
          </>
        );
      }
      return (
        <>
          criou o card em <b className="font-medium text-foreground">{fase(p.faseId)}</b>
          {typeof p.via === "string" && VIA[p.via] ? ` ${VIA[p.via]}` : ""}
        </>
      );
    case "VINCULO_PROJETO":
      if (typeof p.projetoId === "string") {
        return p.criado === true ? (
          <>
            gerou o card de projeto <LinkCard id={p.projetoId} relacionados={relacionados} rotulo="projeto" />
          </>
        ) : (
          <>
            ganhou de novo; o projeto <LinkCard id={p.projetoId} relacionados={relacionados} rotulo="projeto" /> já existia (nada duplicado)
          </>
        );
      }
      if (p.evento === "venda_apagada" || p.evento === "projeto_apagado" || p.evento === "origem_reabertura_apagada") {
        const quem = p.evento === "venda_apagada" ? "a venda de origem" : p.evento === "projeto_apagado" ? "o card de projeto" : "o card de origem (do qual este foi reaberto)";
        return (
          <>
            apagou definitivamente {quem}
            {typeof p.titulo === "string" ? <> “{p.titulo}”</> : null}; o vínculo foi desfeito
          </>
        );
      }
      if (p.evento === "reaberta" || p.evento === "perdida") {
        return (
          <>
            {p.evento === "perdida" ? "marcou como perdida" : "reabriu"} a venda de origem <LinkCard id={p.vendaId} relacionados={relacionados} rotulo="venda" />
            {p.evento === "reaberta" ? (
              <>
                {" "}
                (foi para <b className="font-medium text-foreground">{fase(p.paraFaseId)}</b>)
              </>
            ) : null}
            ; este projeto não foi mexido
          </>
        );
      }
      return (
        <>
          ganhou de novo a venda <LinkCard id={p.vendaId} relacionados={relacionados} rotulo="venda" /> (este projeto segue o mesmo)
        </>
      );
    case "MOVIMENTACAO":
      return (
        <>
          moveu de <b className="font-medium text-foreground">{fase(p.deFaseId)}</b> para <b className="font-medium text-foreground">{fase(p.paraFaseId)}</b>
          {p.motivo === "fase_arquivada" || p.motivo === "fase_removida" ? " (fase de origem removida pela gestão)" : ""}
          {p.motivo === "restauracao" ? " ao restaurar da lixeira (a fase original foi arquivada)" : ""}
        </>
      );
    case "CAMPO_ALTERADO": {
      if (ehCampoVinculo(p.campo)) {
        const nome = (v: unknown) => (typeof v === "string" && v ? v : "—");
        return (
          <>
            alterou <b className="font-medium text-foreground">{ROTULO_VINCULO[p.campo]}</b>:{" "}
            <span className="text-fg-mute line-through decoration-fg-faint">{nome(p.antes)}</span> → <span className="text-foreground">{nome(p.depois)}</span>
            {p.motivo === "apagado_definitivamente" ? " (apagado definitivamente da lixeira)" : null}
          </>
        );
      }
      if (typeof p.campo === "string" && ehCampoTerminal(p.campo)) {
        const c = p.campo;
        return (
          <>
            {p.depois === null ? "limpou" : "registrou"} <b className="font-medium text-foreground">{ROTULO_CAMPO_TERMINAL[c]}</b>:{" "}
            {p.antes !== null ? (
              <>
                <span className="text-fg-mute line-through decoration-fg-faint">{formatarCampoTerminal(c, p.antes)}</span>
                {p.depois !== null ? " → " : null}
              </>
            ) : null}
            {p.depois !== null ? <span className="text-foreground">{formatarCampoTerminal(c, p.depois)}</span> : null}
          </>
        );
      }
      const campo = typeof p.campo === "string" && ehCampoEditavel(p.campo) ? p.campo : null;
      if (!campo) return <>alterou um campo</>;
      return (
        <>
          alterou <b className="font-medium text-foreground">{ROTULO_CAMPO[campo]}</b>:{" "}
          <span className="text-fg-mute line-through decoration-fg-faint">{formatarValorCampo(campo, p.antes, nomes)}</span> →{" "}
          <span className="text-foreground">{formatarValorCampo(campo, p.depois, nomes)}</span>
        </>
      );
    }
    case "NOTA":
      return <>adicionou uma nota</>;
    case "MENSAGEM_WHATSAPP":
      return <>mensagem do WhatsApp</>;
    case "IMPORT":
      return <>importado do Pipefy</>;
    case "EXCLUSAO":
      return <>excluiu o card (foi para a lixeira)</>;
    case "RESTAURACAO":
      return <>restaurou o card da lixeira</>;
    case "PRAZO": {
      const titulo = typeof p.titulo === "string" ? p.titulo : "prazo";
      const dia = typeof p.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dia) ? p.dia : null;
      return (
        <>
          {p.evento === "concluido" ? "concluiu o prazo" : "criou o prazo"} 🏁 <b className="font-medium text-foreground">{titulo}</b>
          {dia ? (
            <>
              {" "}
              {p.evento === "concluido" ? "de" : "para"} <span className="font-mono text-xs tabular">{formatarDia(dia)}</span>
            </>
          ) : null}
        </>
      );
    }
  }
}

/** Timeline cronológica (mais antiga primeiro): criação, movimentos, campos, notas, vínculo venda ↔ projeto. */
export function Timeline({
  entradas,
  fases,
  nomes,
  relacionados = new Map(),
}: {
  entradas: Entrada[];
  fases: ReadonlyMap<string, string>;
  nomes: ReadonlyMap<string, string>;
  relacionados?: ReadonlyMap<string, CardRelacionado>;
}) {
  if (entradas.length === 0) return <p className="text-sm text-fg-faint">Sem histórico.</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {entradas.map((e) => {
        const Icone = ICONE[e.tipo];
        const p = obj(e.payload);
        return (
          <li key={e.id} className="relative">
            <span className="absolute top-0.5 -left-[29px] flex size-4.5 items-center justify-center rounded-full border border-border-strong bg-surface text-fg-mute">
              <Icone className="size-2.5" aria-hidden />
            </span>
            <p className="text-sm text-fg-soft">
              <span className="text-foreground">{e.usuario?.nome ?? "Sistema"}</span> <Descricao e={e} fases={fases} nomes={nomes} relacionados={relacionados} />
            </p>
            {e.tipo === "MENSAGEM_WHATSAPP" ? <MensagemWhatsapp payload={p} /> : null}
            {e.tipo === "NOTA" && typeof p.texto === "string" ? (
              <p className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{p.texto}</p>
            ) : null}
            <time dateTime={e.em.toISOString()} className="mt-0.5 block font-mono text-[11px] text-fg-faint tabular">
              {formatarDataHora(e.em)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
