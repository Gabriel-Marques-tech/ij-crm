import Link from "next/link";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { Destaques } from "@/components/ranking/destaques";
import { FeedRanking } from "@/components/ranking/feed";
import { ListaRanking } from "@/components/ranking/lista-ranking";
import { MeusPontos } from "@/components/ranking/meus-pontos";
import { Podio } from "@/components/ranking/podio";
import { TabelaMetricas, type LinhaMetricas } from "@/components/ranking/tabela-metricas";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import type { Metricas, Participante } from "@/lib/ranking/calculo";
import { resolverPeriodo, type TipoPeriodo } from "@/lib/ranking/periodo";
import { carregarRanking } from "@/lib/ranking/servico";

export const metadata = { title: "Ranking" };

type Busca = { periodo?: string | string[]; ref?: string | string[] };

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const href = (tipo: TipoPeriodo, ref?: string) => `/ranking?periodo=${tipo}${ref ? `&ref=${ref}` : ""}`;

function linhaMetricas(u: Participante, m: Metricas): LinhaMetricas {
  return {
    id: u.id,
    nome: u.nome,
    fotoEm: u.fotoEm,
    pontos: m.pontos,
    ganhos: m.ganhos,
    perdidos: m.perdidos,
    conversao: m.conversao,
    fechado: m.fechado,
    ticketMedio: m.ticketMedio,
    tempoMedioGanhoDias: m.tempoMedioGanhoDias,
    avancos: m.avancos,
    acoesFeitas: m.acoesFeitas,
    abertos: m.abertos,
    emAberto: m.emAberto,
  };
}

const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";
const SETA = "inline-flex size-8 items-center justify-center rounded-lg border border-border text-fg-soft hover:bg-surface-hover hover:text-foreground";

/** Ranking de vendas (GAB-44): pódio, classificação, destaques, métricas e feed. */
export default async function RankingPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const busca = await searchParams;
  const tipo: TipoPeriodo = um(busca.periodo) === "mes" ? "mes" : "semana";
  const agora = new Date();
  const periodo = resolverPeriodo(tipo, um(busca.ref), agora);
  const visao = await comTratamento("pagina.ranking", () => carregarRanking(ator, periodo, agora));
  if (ehInesperado(visao)) return <ErroCarregamento codigo={visao.ref} />;

  const navegacao = (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Período" className="flex rounded-lg border border-border bg-surface p-0.5">
        {(["semana", "mes"] as const).map((t) => (
          <Link key={t} href={href(t)} aria-current={t === tipo ? "page" : undefined} className={cn(ABA, t === tipo ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
            {t === "semana" ? "Semana" : "Mês"}
          </Link>
        ))}
      </nav>
      <Link href={href(tipo, periodo.anterior)} className={SETA} aria-label={tipo === "semana" ? "Semana anterior" : "Mês anterior"}>
        <ChevronLeft className="size-4" />
      </Link>
      {periodo.proximo ? (
        <Link href={href(tipo, periodo.proximo)} className={SETA} aria-label={tipo === "semana" ? "Próxima semana" : "Próximo mês"}>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className={cn(SETA, "pointer-events-none opacity-40")}>
          <ChevronRight className="size-4" />
        </span>
      )}
      {!periodo.atual ? (
        <Link href={href(tipo)} className="font-mono text-xs text-fg-mute hover:text-foreground hover:underline">
          {tipo === "semana" ? "semana atual" : "mês atual"}
        </Link>
      ) : null}
    </div>
  );

  const titulo = `${tipo === "semana" ? "Semana" : "Mês"}: ${periodo.rotulo}`;

  if (visao.modo === "proprio") {
    const eu = visao.eu;
    return (
      <>
        <PageHeader eyebrow={titulo} title="Seus pontos" description="O ranking do time está oculto pelo gestor. Aqui ficam só os seus números do período." actions={navegacao} />
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            {eu ? (
              <section className="space-y-3">
                <h2 className="eyebrow">suas métricas</h2>
                <TabelaMetricas linhas={[linhaMetricas(eu.usuario, eu)]} time={null} euId={ator.id} />
              </section>
            ) : null}
          </div>
          <aside className="space-y-6">
            <MeusPontos eu={eu} pesos={visao.config.pesos} />
            <FeedRanking itens={visao.feed} vazio="Você não teve ganhos nem avanços de fase nos últimos 7 dias." />
          </aside>
        </div>
      </>
    );
  }

  const { ranking, eu } = visao;
  return (
    <>
      <PageHeader eyebrow={titulo} title="Ranking de vendas" description="Pontos por vendas ganhas, avanços de fase, próximas ações feitas e cards criados." actions={navegacao} />
      <div className="space-y-8">
        <Podio linhas={ranking.linhas} euId={ator.id} />
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <ListaRanking linhas={ranking.linhas} euId={ator.id} />
          <aside className="space-y-6">
            {/* VISUALIZADOR não pontua (nem está no ranking): sem "Meus pontos". */}
            {ator.papel === "VISUALIZADOR" ? null : <MeusPontos eu={eu} pesos={visao.config.pesos} posicao={eu?.posicao} />}
            <FeedRanking itens={visao.feed} vazio="Nenhum ganho nem avanço de fase nos últimos 7 dias." />
          </aside>
        </div>
        <section className="space-y-3">
          <h2 className="eyebrow">destaques do período</h2>
          <Destaques destaques={ranking.destaques} />
        </section>
        <section className="space-y-3">
          <h2 className="eyebrow">métricas por vendedor</h2>
          <TabelaMetricas linhas={ranking.linhas.map((l) => linhaMetricas(l.usuario, l))} time={linhaMetricas({ id: "time", nome: "Time", fotoEm: null }, ranking.time)} euId={ator.id} />
          <p className="text-xs text-fg-faint">
            Período em dias de São Paulo. &quot;Abertos hoje&quot; e &quot;R$ em aberto&quot; são a situação atual, não do período. Mínimos dos destaques: conversão com{" "}
            {visao.config.minimos.fechadosConversao}+ fechadas; fechamento mais rápido com {visao.config.minimos.ganhosTempo}+ ganhos.
          </p>
        </section>
      </div>
    </>
  );
}
