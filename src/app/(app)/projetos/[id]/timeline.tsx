import Link from "next/link";
import { ArrowRightLeft, MessageSquareText, Pencil, Plus, Download, MessageCircle, Link2, Trash2, ArchiveRestore, Flag, Paperclip, FileText, ClipboardCheck, CalendarCheck } from "lucide-react";
import type { StatusCheckin, TipoTimeline } from "@prisma/client";
import { ehCampoEditavel, ROTULO_CAMPO } from "@/lib/projetos/campos";
import { ROTULO_CAMPO_TERMINAL, ehCampoTerminal, formatarCampoTerminal, formatarDataHora, formatarDia, formatarValorCampo } from "@/lib/projetos/formatar";
import type { DetalheCard } from "@/lib/projetos/projetos";
import { ehCampoVinculo, ROTULO_VINCULO } from "@/lib/projetos/vinculos";
import { ROTULO_CHECKIN } from "@/lib/projetos/execucao-regras";
import { ROTULO_ITEM, type ItemManual } from "@/lib/projetos/handoff-regras";
import { BadgeSentimento, NotaContatoExibida } from "@/components/avaliacao/nota-contato";
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
  ANEXO: Paperclip,
  PROPOSTA: FileText,
  HANDOFF: ClipboardCheck,
  EXECUCAO: CalendarCheck,
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
    <Link href={`/projetos/${id}`} className="font-medium text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
      {c.titulo}
    </Link>
  );
}

function Descricao({
  e,
  fases,
  nomes,
  relacionados,
  mesmoCard,
}: {
  e: Entrada;
  fases: ReadonlyMap<string, string>;
  nomes: ReadonlyMap<string, string>;
  relacionados: ReadonlyMap<string, CardRelacionado>;
  mesmoCard: ReadonlySet<string>;
}) {
  const p = obj(e.payload);
  const fase = (id: unknown) => (typeof id === "string" ? (fases.get(id) ?? "fase removida") : "—");
  const ehEste = (id: unknown) => typeof id === "string" && mesmoCard.has(id);
  switch (e.tipo) {
    case "CRIACAO":
      // Histórico herdado do card de projetos da v1 (unido a este no ciclo único, GAB-81).
      if (p.via === "GANHO" && ehEste(p.origemOportunidadeId)) {
        return (
          <>
            levou o card para o quadro Projetos em <b className="font-medium text-foreground">{fase(p.faseId)}</b> pelo ganho
          </>
        );
      }
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
          {/* Pelo MCP a criação passa pelo mesmo caminho da tela (via UI): a marca "via MCP" já diz de onde veio. */}
          {!e.viaMcp && typeof p.via === "string" && VIA[p.via] ? ` ${VIA[p.via]}` : ""}
        </>
      );
    case "VINCULO_PROJETO":
      if (p.evento === "ciclo_unico_nao_unido") {
        const outro = typeof p.projetoId === "string" ? p.projetoId : p.vendaId;
        return (
          <>
            manteve separados, no ciclo único, a venda e o card de projetos da v1 (a venda tinha saído do ganho
            {typeof p.vendaFase === "string" ? <>: estava em “{p.vendaFase}”</> : null}); o outro card é{" "}
            <LinkCard id={outro} relacionados={relacionados} rotulo={typeof p.projetoId === "string" ? "projeto" : "venda"} />
          </>
        );
      }
      if (p.evento === "reganho_projeto_existente") {
        return typeof p.projetoId === "string" ? (
          <>
            ganhou de novo e seguiu para o Handoff como card próprio; o projeto da venda anterior já existe:{" "}
            <LinkCard id={p.projetoId} relacionados={relacionados} rotulo="projeto" />
          </>
        ) : (
          <>
            a venda <LinkCard id={p.vendaId} relacionados={relacionados} rotulo="venda" /> foi ganha de novo e seguiu para o Handoff como card próprio
          </>
        );
      }
      if (p.evento === "ciclo_unico") {
        return <>uniu a venda e o card de projetos da v1 neste card (ciclo único): histórico dos dois juntos</>;
      }
      if (typeof p.projetoId === "string" && ehEste(p.projetoId)) {
        return p.criado === true ? <>ganhou: o card seguiu para o quadro Projetos</> : <>ganhou de novo (nada duplicado)</>;
      }
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
          {p.motivo === "ganho_handoff" ? " (ganho: o card seguiu para o quadro Projetos)" : ""}
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
    case "HANDOFF": {
      // GAB-93.
      const b = (v: unknown, resto: string) => <b className="font-medium text-foreground">{typeof v === "string" && v ? v : resto}</b>;
      const item = typeof p.item === "string" && p.item in ROTULO_ITEM ? ROTULO_ITEM[p.item as ItemManual] : "item";
      if (p.evento === "gp_designado") return <>designou {b(p.gpNome, "alguém")} como GP do projeto</>;
      if (p.evento === "item_marcado") return <>marcou no checklist de handoff: {b(item, "item")}</>;
      if (p.evento === "item_desmarcado") return <>desmarcou no checklist de handoff: {b(item, "item")}</>;
      if (p.evento === "resumo_salvo") return <>escreveu o resumo de handoff</>;
      if (p.evento === "contrato_definido") return <>definiu {b(p.nome, "um anexo")} como o contrato assinado</>;
      return <>atualizou o handoff</>;
    }
    case "EXECUCAO": {
      // GAB-95.
      const b = (v: unknown, resto: string) => <b className="font-medium text-foreground">{typeof v === "string" && v ? v : resto}</b>;
      const dia = (v: unknown) => (typeof v === "string" ? formatarDia(v) : "—");
      if (p.evento === "cronograma_copiado") {
        // `versao` não vem para quem não vê a proposta (`timelineSemProposta`).
        const partes = [...(typeof p.versao === "number" ? [`v${p.versao}`] : []), `${String(p.entregas ?? 0)} entregas`, ...(typeof p.ignoradas === "number" && p.ignoradas > 0 ? [`${p.ignoradas} ignoradas por data inválida`] : [])];
        return <>copiou o cronograma da proposta ({partes.join(", ")})</>;
      }
      if (p.evento === "entrega_adicionada") return <>lançou a entrega {b(p.titulo, "entrega")}, prevista para {dia(p.dia)}</>;
      if (p.evento === "entrega_feita" && typeof p.antes === "string") return <>corrigiu a data real da entrega {b(p.titulo, "entrega")} de {dia(p.antes)} para {dia(p.dia)}</>;
      if (p.evento === "entrega_cancelada") return <>cancelou a entrega {b(p.titulo, "entrega")}: {typeof p.motivo === "string" ? p.motivo : ""}</>;
      if (p.evento === "entrega_feita") return <>marcou como feita a entrega {b(p.titulo, "entrega")} em {dia(p.dia)} (prevista para {dia(p.previsto)})</>;
      if (p.evento === "entrega_desmarcada") return <>desmarcou a entrega {b(p.titulo, "entrega")}, que estava feita em {dia(p.dia)}</>;
      if (p.evento === "data_ajustada") return <>ajustou a entrega {b(p.titulo, "entrega")} de {dia(p.de)} para {dia(p.para)}: {typeof p.motivo === "string" ? p.motivo : ""}</>;
      if (p.evento === "checkin") {
        const cor = typeof p.status === "string" && p.status in ROTULO_CHECKIN ? ROTULO_CHECKIN[p.status as StatusCheckin] : "?";
        return <>fez o check-in da semana: {b(cor, "?")}. {typeof p.motivo === "string" ? p.motivo : ""}</>;
      }
      return <>atualizou o cronograma</>;
    }
    case "ANEXO": {
      // GAB-84. O nome fica como texto (sem link): o anexo pode já ter sido excluído.
      const nome = <b className="font-medium text-foreground">{typeof p.nome === "string" ? p.nome : "arquivo"}</b>;
      if (p.evento === "excluido") return <>excluiu o anexo {nome} (foi para a lixeira)</>;
      if (p.evento === "restaurado") return <>restaurou da lixeira o anexo {nome}</>;
      if (p.evento === "apagado") return <>apagou definitivamente o anexo {nome}</>;
      return (
        <>
          anexou {nome}
          {p.contratoAssinado === true ? <span className="text-fg-mute"> como o contrato assinado</span> : null}
          {p.semTexto === true ? <span className="text-fg-mute"> (sem texto: escaneado ou imagem)</span> : null}
        </>
      );
    }
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
    case "PROPOSTA": {
      // GAB-86: criação e versões salvas. GAB-87: passagens da caneta (nomes gravados no payload). GAB-89: envio e resposta.
      const projetoId = e.projetoId;
      const nome = (v: unknown) => (typeof v === "string" && v ? v : null);
      const lado = (v: unknown) => (v === "VENDAS" ? "vendas" : v === "PROJETOS" ? "projetos" : null);
      const versao = (n: unknown) =>
        typeof n === "number" ? (
          <Link
            href={`/projetos/${projetoId}/proposta/versoes/${n}`}
            className="font-medium text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground"
          >
            v{n}
          </Link>
        ) : null;
      const quem = (v: unknown) => <b className="font-medium text-foreground">{nome(v) ?? "alguém"}</b>;
      switch (p.evento) {
        case "devolvida":
          return (
            <>
              devolveu a proposta ({versao(p.numero)}) para {quem(p.paraNome)}
              {lado(p.lado) ? <span className="text-fg-mute"> · {lado(p.lado)}</span> : null}
            </>
          );
        case "concordou":
          return (
            <>
              concordou com a {versao(p.numero)}: proposta <b className="font-medium text-foreground">pronta para envio</b>
            </>
          );
        // GAB-91: o histórico de resolver/reabrir comentários da proposta.
        case "comentario_resolvido":
          return <>resolveu um comentário da proposta</>;
        case "comentario_reaberto":
          return <>reabriu um comentário da proposta</>;
        case "sugestao_aplicada":
          return <>aplicou uma sugestão de texto na proposta</>;
        case "revisao_enviada":
          return <>enviou uma revisão da proposta</>;
        case "caneta_passada":
          return <>passou a caneta da proposta para {quem(p.paraNome)}</>;
        case "caneta_pega":
          return <>pegou a caneta da proposta{nome(p.deNome) ? <> (estava com {quem(p.deNome)})</> : null}</>;
        case "reaberta":
          return <>reabriu a proposta para ajuste</>;
        case "reaberta_do_perdido":
          return p.de === "RECUSADA" ? (
            <>reabriu o card: a proposta recusada voltou como revisão pedida, com vendas (o GP de vendas pega a caneta)</>
          ) : (
            <>reabriu o card: a proposta inviável voltou para ajuste com vendas (o GP de vendas pega a caneta)</>
          );
        // GAB-89: envio e resposta do cliente.
        case "enviada":
          return (
            <>
              marcou a proposta ({versao(p.numero)}) como <b className="font-medium text-foreground">enviada</b> ao cliente
            </>
          );
        case "aceita":
          return (
            <>
              registrou: o cliente <b className="font-medium text-foreground">aceitou</b> a proposta{typeof p.numero === "number" ? <> ({versao(p.numero)})</> : null}
            </>
          );
        case "recusada":
          return (
            <>
              registrou: o cliente <b className="font-medium text-foreground">recusou</b> a proposta
              {nome(p.motivo) ? <span className="text-fg-mute"> — “{p.motivo as string}”</span> : null}
            </>
          );
        case "revisao_pedida":
          return (
            <>
              registrou: o cliente <b className="font-medium text-foreground">pediu revisão</b> da proposta
              {nome(p.pedido) ? <span className="text-fg-mute"> — “{p.pedido as string}”</span> : null}
            </>
          );
        case "revisao_concluida":
          return (
            <>
              concluiu a revisão ({versao(p.numero)}): proposta <b className="font-medium text-foreground">pronta para envio</b> de novo
            </>
          );
        case "caneta_liberada":
          return <>a caneta da proposta ficou sem dono ({quem(p.deNome)} {p.motivo === "desativado" ? "foi desativado(a)" : "não é mais do lado"}); o GP do lado pega</>;
        case "inviavel":
          return (
            <>
              marcou a proposta como <b className="font-medium text-foreground">inviável</b>
              {nome(p.motivo) ? <span className="text-fg-mute"> — “{p.motivo as string}”</span> : null}
            </>
          );
      }
      if (p.evento === "versao_salva" && typeof p.numero === "number") {
        return (
          <>
            salvou a{" "}
            <Link
              href={`/projetos/${projetoId}/proposta/versoes/${p.numero}`}
              className="font-medium text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground"
            >
              versão v{p.numero}
            </Link>{" "}
            da proposta
            {typeof p.nota === "string" && p.nota ? <span className="text-fg-mute"> — “{p.nota}”</span> : null}
          </>
        );
      }
      if (p.evento === "criada") {
        return (
          <>
            criou a{" "}
            <Link href={`/projetos/${projetoId}/proposta`} className="font-medium text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
              proposta
            </Link>
          </>
        );
      }
      return <>atualizou a proposta</>;
    }
  }
}

/** Timeline cronológica (mais antiga primeiro): criação, movimentos, campos, notas, vínculo venda ↔ projeto. */
export function Timeline({
  entradas,
  fases,
  nomes,
  relacionados = new Map(),
  mesmoCard = new Set(),
}: {
  entradas: Entrada[];
  fases: ReadonlyMap<string, string>;
  nomes: ReadonlyMap<string, string>;
  relacionados?: ReadonlyMap<string, CardRelacionado>;
  /** Este card + os cards de projetos da v1 absorvidos por ele (GAB-81). */
  mesmoCard?: ReadonlySet<string>;
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
              <span className="text-foreground">{e.usuario?.nome ?? "Sistema"}</span> <Descricao e={e} fases={fases} nomes={nomes} relacionados={relacionados} mesmoCard={mesmoCard} />
              {e.viaMcp ? (
                <span title="Feito pelo Claude desta pessoa, pelo conector MCP" className="ml-1.5 rounded border border-border px-1 py-px font-mono text-[10px] text-fg-mute">
                  via MCP
                </span>
              ) : null}
            </p>
            {e.tipo === "MENSAGEM_WHATSAPP" ? <MensagemWhatsapp payload={p} /> : null}
            {e.tipo === "NOTA" && typeof p.texto === "string" ? (
              <p className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{p.texto}</p>
            ) : null}
            {e.nota !== null || e.sentimento !== null ? (
              // GAB-85: avaliação do contato (colunas próprias; ficam depois da purga do JSON da LLM).
              <div className="mt-1 flex flex-wrap gap-1.5">
                {e.nota !== null ? <NotaContatoExibida nota={e.nota} /> : null}
                {e.sentimento !== null ? <BadgeSentimento sentimento={e.sentimento} /> : null}
              </div>
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
