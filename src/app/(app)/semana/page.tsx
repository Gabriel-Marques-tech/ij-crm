import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { ErroCarregamento } from "@/components/erro-carregamento";
import { EstadoVazio } from "@/components/estado-vazio";
import { PageHeader } from "@/components/shell/page-header";
import { db } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { carregarItens } from "@/lib/calendario/calendario";
import { resolverSemana } from "@/lib/calendario/semana";
import { dividirSemana, fimDaJanela } from "@/lib/semana/colunas";
import { listarResponsaveis } from "@/lib/oportunidades/oportunidades";
import { agruparSemana } from "@/lib/semana/agrupar";
import { listarCardsDoVendedor, resolverVendedor } from "@/lib/semana/semana";
import { Legenda } from "@/components/calendario/legenda";
import { carregarTop3 } from "@/lib/ranking/servico";
import { Top3Semana } from "@/components/ranking/top3-semana";
import { BotaoNovoPrazo, PrazosProvider } from "../_calendario/editor-prazo";
import { Destaque, Grupo } from "../_semana/itens";
import { ProximaSemana } from "../_semana/proxima-semana";
import { SemanaEmColunas } from "../_semana/semana-colunas";
import { SeletorVendedor } from "../_semana/seletor-vendedor";

export const metadata = { title: "Minha Semana" };

const hojeExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

const horaSP = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" });

function saudacao(agora: Date): string {
  const h = Number(horaSP.format(agora));
  if (h < 5) return "Boa madrugada.";
  if (h < 12) return "Bom dia.";
  if (h < 18) return "Boa tarde.";
  return "Boa noite.";
}

/**
 * Minha Semana (GAB-33, §4.5): próximas ações do vendedor, padrão "Today" do
 * ics-select. GAB-51: "Hoje / Próximos 7 dias" viraram a semana (seg–dom) em
 * colunas, com os mesmos mini-cards e prazos 🏁 do Calendário.
 */
export default async function MinhaSemanaPage({ searchParams }: { searchParams: Promise<{ vendedor?: string | string[] }> }) {
  const ator = await exigirUsuario();
  const { vendedor } = await searchParams;
  const agora = new Date();
  const hoje = diaEmFuso(agora);
  const semana = resolverSemana(undefined, agora);
  // Uma leitura de segunda até hoje+7: colunas (seg–dom) + "Próxima semana" (o resto do antigo "Próximos 7 dias").
  const ate = fimDaJanela(semana);
  // Top 3 em paralelo e isolado: se falhar, só o card lateral mostra a ref (GAB-44).
  const top3 = comTratamento("pagina.semana.top3", () => carregarTop3(ator, agora));
  const dados = await comTratamento("pagina.semana", async () => {
    const escolha = await resolverVendedor(ator, typeof vendedor === "string" ? vendedor : undefined);
    const [cards, itens, foto, responsaveis] = await Promise.all([
      listarCardsDoVendedor(escolha.alvo.id),
      carregarItens({ responsavelIds: [escolha.alvo.id] }, { primeiroDia: semana.segunda, ultimoDia: ate, hoje: semana.hoje }, ator),
      db.usuarioFoto.findUnique({ where: { usuarioId: escolha.alvo.id }, select: { atualizadoEm: true } }),
      escolha.podeTrocar ? escolha.opcoes : listarResponsaveis(),
    ]);
    return { escolha, s: agruparSemana(cards, agora), cards, itens, foto, responsaveis };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const ranking = await top3;
  const { escolha, s, cards, itens, foto, responsaveis } = dados;
  // O destaque (Mais urgente) também aparece na grade, marcado como urgente.
  const { dias, proxima } = dividirSemana(semana, itens);
  // Vencidas de antes desta semana não cabem nas colunas: seguem em lista (com "marcar feita").
  const vencidasAntes = s.vencidas.filter((c) => diaEmFuso(c.proximaAcaoEm!) < semana.segunda);
  const depois = cards.filter((c) => c.proximaAcaoEm && diaEmFuso(c.proximaAcaoEm) > ate).length;
  const proprio = escolha.alvo.id === ator.id;
  const primeiroNome = escolha.alvo.nome.split(" ")[0];
  const nada = s.destaque === null && s.sem.length === 0;

  return (
    <>
      <PageHeader
        leading={<Avatar nome={escolha.alvo.nome} usuarioId={escolha.alvo.id} fotoEm={foto?.atualizadoEm.getTime() ?? null} tamanho="md" />}
        eyebrow={hojeExtenso.format(agora)}
        title={proprio ? saudacao(agora) : `Semana de ${escolha.alvo.nome}`}
        description={
          proprio
            ? "Suas próximas ações nos cards abertos em que você é responsável."
            : `Próximas ações dos cards abertos em que ${primeiroNome} é responsável.`
        }
        actions={escolha.podeTrocar ? <SeletorVendedor atualId={escolha.alvo.id} proprioId={ator.id} opcoes={escolha.opcoes} /> : undefined}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-8">
          {s.destaque && s.destaqueFaixa ? (
            <Destaque c={s.destaque} faixa={s.destaqueFaixa} agora={agora} hoje={hoje} />
          ) : (
            <section className="rounded-xl border border-border bg-surface">
              <EstadoVazio
                mascote="relax"
                titulo="Tudo em dia por aqui"
                className="py-8"
                texto={
                  nada
                    ? proprio
                      ? "Nada vencido, nada para hoje. Você não tem cards abertos agora: crie um no Kanban quando surgir um lead."
                      : `Nada vencido, nada para hoje. ${primeiroNome} não tem cards abertos agora.`
                    : "Nada vencido, nada para hoje, nem nos próximos 7 dias. Bom momento para revisar os cards sem próxima ação abaixo."
                }
              />
            </section>
          )}

          {s.totais.vencida === 0 && s.destaque ? (
            <p className="flex items-center gap-2 text-sm text-fg-soft">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              Nada vencido. Bom trabalho.
            </p>
          ) : null}

          {vencidasAntes.length > 0 ? (
            <Grupo titulo="Vencidas antes desta semana" total={vencidasAntes.length} cor="bg-danger" itens={vencidasAntes} agora={agora} hoje={hoje} vazio={null} />
          ) : null}
        </div>
        <aside className="lg:sticky lg:top-6">
          {ehInesperado(ranking) ? <ErroCarregamento codigo={ranking.ref} /> : <Top3Semana dados={ranking} euId={ator.id} />}
        </aside>
      </div>

      <PrazosProvider eu={{ id: ator.id, nome: ator.nome }} gestor={temPapelMinimo(ator.papel, "GESTOR")} responsaveis={responsaveis} responsavelPadrao={escolha.alvo.id}>
        <section aria-labelledby="semana-colunas" className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="semana-colunas" className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              Esta semana
              <span className="font-mono text-xs text-fg-mute tabular">{semana.rotulo}</span>
            </h2>
            <div className="flex items-center gap-3">
              <Link
                href={proprio ? "/calendario" : `/calendario?pessoa=${encodeURIComponent(escolha.alvo.id)}`}
                className="font-mono text-xs text-fg-mute hover:text-foreground hover:underline"
              >
                abrir no Calendário
              </Link>
              <BotaoNovoPrazo dia={hoje} variant="outline" />
            </div>
          </div>
          <SemanaEmColunas dias={dias} hoje={semana.hoje} urgenteId={s.destaque?.id ?? null} />
          <Legenda />
          <ProximaSemana acoes={proxima.acoes} prazos={proxima.prazos} ate={ate} depois={depois} kanbanHref={`/kanban?resp=${encodeURIComponent(escolha.alvo.id)}`} />
        </section>
      </PrazosProvider>

      <div className="mt-8 space-y-4">
        <Grupo
          titulo="Sem próxima ação"
          total={s.totais.sem}
          cor="bg-fg-faint"
          itens={s.sem}
          agora={agora}
          hoje={hoje}
          vazio="Todos os cards abertos têm próxima ação."
        />
      </div>
    </>
  );
}
