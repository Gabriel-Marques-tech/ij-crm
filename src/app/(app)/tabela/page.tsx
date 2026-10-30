import type { ReactNode } from "react";
import { EstadoVazio } from "@/components/estado-vazio";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/page-header";
import { DiasNaFase } from "@/components/kanban/aging";
import { Button } from "@/components/ui/button";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarPipelines } from "@/lib/fases/fases";
import { estadoProximaAcao } from "@/lib/projetos/aging";
import { ROTULO_ORIGEM } from "@/lib/projetos/campos";
import { formatarDinheiro } from "@/lib/projetos/formatar";
import { escreverEstado, lerEstado, paramsDeRegistro, proximaOrdem, type ColunaOrdenavel, type EstadoTabela } from "@/lib/tabela/params";
import { listarPessoas, listarTabela, POR_PAGINA, type LinhaTabela, type RefTabela } from "@/lib/tabela/tabela";
import { BarraFiltrosTabela } from "./painel-filtros-tabela";

export const metadata = { title: "Tabela" };

/** "Agora" do request (ver Kanban): server component renderiza uma vez por request. */
function agoraDoRequest(): Date {
  return new Date();
}

const DATA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" });

function href(e: EstadoTabela, base = "/tabela"): string {
  const qs = escreverEstado(e).toString();
  return qs ? `${base}?${qs}` : base;
}

type Coluna = { chave: ColunaOrdenavel; rotulo: string; className?: string };

const COLUNAS: Coluna[] = [
  { chave: "titulo", rotulo: "título", className: "min-w-56" },
  { chave: "empresa", rotulo: "empresa" },
  { chave: "contato", rotulo: "contato" },
  { chave: "fase", rotulo: "fase" },
  { chave: "responsavel", rotulo: "responsável" },
  { chave: "origem", rotulo: "origem" },
  { chave: "diasNaFase", rotulo: "na fase", className: "text-right" },
  { chave: "proximaAcao", rotulo: "próxima ação", className: "min-w-48" },
  { chave: "orcamento", rotulo: "orçamento", className: "text-right" },
  { chave: "criado", rotulo: "criado em", className: "text-right" },
];

export default async function TabelaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const usuario = await exigirUsuario();
  const estado = lerEstado(paramsDeRegistro(await searchParams));
  const agora = agoraDoRequest();
  const [pipelines, pessoas, pagina] = await Promise.all([listarPipelines(), listarPessoas(), listarTabela(estado, agora)]);
  const atual: EstadoTabela = { ...estado, pagina: pagina.pagina };
  const inicio = pagina.total ? (pagina.pagina - 1) * POR_PAGINA + 1 : 0;
  const fim = (pagina.pagina - 1) * POR_PAGINA + pagina.linhas.length;

  return (
    <>
      <PageHeader
        eyebrow="projetos · tabela"
        title="Tabela"
        description="Todos os projetos, de todos os quadros. Clique no cabeçalho para ordenar e na linha para abrir o card."
        actions={
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={href({ ...atual, pagina: 1 }, "/tabela/csv")} />}>
            <Download />
            Exportar CSV
          </Button>
        }
      />

      <BarraFiltrosTabela
        filtros={estado.filtros}
        ordem={estado.ordem}
        pipelines={pipelines.map((p) => ({ chave: p.chave, nome: p.nome, fases: p.fases.map((f) => ({ id: f.id, nome: f.nome })) }))}
        pessoas={pessoas}
        meuId={usuario.id}
        total={pagina.total}
      />

      {pagina.total === 0 ? (
        <EstadoVazio
          mascote="cabeca"
          titulo="Nenhum projeto com esses filtros"
          texto="Mude ou limpe os filtros acima."
          className="rounded-xl border border-dashed border-border-strong bg-surface/40"
        />
      ) : (
        <>
          {/* Rolagem horizontal só aqui dentro: a página nunca rola de lado. */}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {COLUNAS.map((c) => (
                    <Cabecalho key={c.chave} coluna={c} estado={atual} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagina.linhas.map((l) => (
                  <Linha key={l.id} l={l} agora={agora} />
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-fg-mute tabular">
              {inicio}–{fim} de {pagina.total}
            </span>
            <div className="flex items-center gap-2">
              <BotaoPagina estado={atual} pagina={pagina.pagina - 1} desabilitado={pagina.pagina <= 1} rotulo="Página anterior">
                <ChevronLeft />
              </BotaoPagina>
              <span className="font-mono text-xs text-fg-soft tabular">
                {pagina.pagina} / {pagina.paginas}
              </span>
              <BotaoPagina estado={atual} pagina={pagina.pagina + 1} desabilitado={pagina.pagina >= pagina.paginas} rotulo="Próxima página">
                <ChevronRight />
              </BotaoPagina>
            </div>
          </nav>
        </>
      )}
    </>
  );
}

function Cabecalho({ coluna, estado }: { coluna: Coluna; estado: EstadoTabela }) {
  const ativa = estado.ordem.coluna === coluna.chave;
  const Seta = estado.ordem.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={ativa ? (estado.ordem.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("eyebrow px-3 py-2.5 font-normal whitespace-nowrap", coluna.className)}>
      <Link
        href={href({ ...estado, ordem: proximaOrdem(estado.ordem, coluna.chave), pagina: 1 })}
        scroll={false}
        className={cn("inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50", ativa && "text-foreground")}
      >
        {coluna.rotulo}
        {ativa ? <Seta aria-hidden className="size-3" /> : null}
      </Link>
    </th>
  );
}

function BotaoPagina({ estado, pagina, desabilitado, rotulo, children }: { estado: EstadoTabela; pagina: number; desabilitado: boolean; rotulo: string; children: ReactNode }) {
  if (desabilitado) {
    return (
      <Button variant="outline" size="icon-sm" disabled aria-label={rotulo}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon-sm" aria-label={rotulo} nativeButton={false} render={<Link href={href({ ...estado, pagina })} scroll={false} />}>
      {children}
    </Button>
  );
}

function TextoRef({ r }: { r: RefTabela | null }) {
  if (!r) return <span className="text-fg-faint">—</span>;
  return <span className={cn("block max-w-48 truncate", r.excluido ? "text-fg-mute" : "text-fg-soft")}>{r.nome}</span>;
}

function Linha({ l, agora }: { l: LinhaTabela; agora: Date }) {
  const acao = estadoProximaAcao(l.proximaAcaoEm, agora);
  return (
    // `relative` + link esticado no título: a linha inteira abre o card.
    <tr className="relative border-b border-border last:border-0 hover:bg-surface-hover">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/projetos/${l.id}`}
            className="block max-w-72 truncate text-foreground outline-none after:absolute after:inset-0 focus-visible:underline hover:underline"
          >
            {l.titulo}
          </Link>
          {l.revisar ? <span className="shrink-0 rounded-full border border-warn/60 px-1.5 font-mono text-[10px] leading-4 text-fg-soft uppercase">revisar</span> : null}
        </div>
      </td>
      <td className="px-3 py-2">
        <TextoRef r={l.empresa} />
      </td>
      <td className="px-3 py-2">
        <TextoRef r={l.contato} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="text-fg-soft">{l.fase.nome}</span>{" "}
        <span className="font-mono text-[10px] text-fg-faint">{l.pipeline.chave}</span>
        {l.fase.tipoTerminal ? (
          <span className={cn("ml-1.5 rounded-full border px-1.5 font-mono text-[10px] leading-4 text-fg-soft uppercase", l.fase.tipoTerminal === "GANHO" ? "border-success/60" : "border-danger/60")}>
            {l.fase.tipoTerminal === "GANHO" ? "ganho" : "perdido"}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-fg-soft">{l.responsavel.nome}</td>
      <td className="px-3 py-2 whitespace-nowrap text-fg-soft">{l.origem ? ROTULO_ORIGEM[l.origem] : <span className="text-fg-faint">—</span>}</td>
      <td className="px-3 py-2 text-right">
        <DiasNaFase dias={l.diasNaFase} nivel={l.aging} />
      </td>
      <td className="px-3 py-2">
        {l.proximaAcaoEm || l.proximaAcao ? (
          <div className="flex items-baseline gap-2">
            {l.proximaAcaoEm ? (
              <span className={cn("shrink-0 font-mono text-xs tabular", acao === "vencida" ? "text-danger" : acao === "hoje" ? "text-warn" : "text-fg-mute")}>
                {DATA.format(l.proximaAcaoEm)}
              </span>
            ) : null}
            <span className="block max-w-56 truncate text-fg-soft">{l.proximaAcao}</span>
          </div>
        ) : (
          <span className="text-fg-faint">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-fg-soft tabular">{l.orcamentoPrevisto ? formatarDinheiro(l.orcamentoPrevisto) : "—"}</td>
      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-fg-mute tabular">{DATA.format(l.criadoEm)}</td>
    </tr>
  );
}
