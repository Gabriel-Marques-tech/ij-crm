import { ArrowRightLeft, MessageSquareText, Pencil, Plus, Download, MessageCircle } from "lucide-react";
import type { TipoTimeline } from "@prisma/client";
import { ehCampoEditavel, ROTULO_CAMPO } from "@/lib/oportunidades/campos";
import { formatarDataHora, formatarValorCampo } from "@/lib/oportunidades/formatar";
import type { DetalheCard } from "@/lib/oportunidades/oportunidades";

type Entrada = DetalheCard["timeline"][number];
type Payload = Record<string, unknown>;

const ICONE: Record<TipoTimeline, typeof Plus> = {
  CRIACAO: Plus,
  MOVIMENTACAO: ArrowRightLeft,
  CAMPO_ALTERADO: Pencil,
  NOTA: MessageSquareText,
  MENSAGEM_WHATSAPP: MessageCircle,
  IMPORT: Download,
};

const VIA: Record<string, string> = { UI: "pelo app", WHATSAPP: "pelo WhatsApp", IMPORT: "pela importação" };

function obj(p: unknown): Payload {
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Payload) : {};
}

function Descricao({ e, fases, nomes }: { e: Entrada; fases: ReadonlyMap<string, string>; nomes: ReadonlyMap<string, string> }) {
  const p = obj(e.payload);
  const fase = (id: unknown) => (typeof id === "string" ? (fases.get(id) ?? "fase removida") : "—");
  switch (e.tipo) {
    case "CRIACAO":
      return (
        <>
          criou o card em <b className="font-medium text-foreground">{fase(p.faseId)}</b>
          {typeof p.via === "string" && VIA[p.via] ? ` ${VIA[p.via]}` : ""}
        </>
      );
    case "MOVIMENTACAO":
      return (
        <>
          moveu de <b className="font-medium text-foreground">{fase(p.deFaseId)}</b> para <b className="font-medium text-foreground">{fase(p.paraFaseId)}</b>
          {p.motivo === "fase_arquivada" || p.motivo === "fase_removida" ? " (fase de origem removida pela gestão)" : ""}
        </>
      );
    case "CAMPO_ALTERADO": {
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
  }
}

/** Timeline cronológica (mais antiga primeiro): criação, movimentos, campos, notas. */
export function Timeline({ entradas, fases, nomes }: { entradas: Entrada[]; fases: ReadonlyMap<string, string>; nomes: ReadonlyMap<string, string> }) {
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
              <span className="text-foreground">{e.usuario?.nome ?? "Sistema"}</span> <Descricao e={e} fases={fases} nomes={nomes} />
            </p>
            {(e.tipo === "NOTA" || e.tipo === "MENSAGEM_WHATSAPP") && typeof p.texto === "string" ? (
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
