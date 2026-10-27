import { ErroCarregamento } from "@/components/erro-carregamento";
import { Legenda } from "@/components/calendario/legenda";
import { exigirUsuario } from "@/lib/auth/atual";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { carregarItens, resolverVisao } from "@/lib/calendario/calendario";
import { paramsDoPeriodo, periodoDaBusca, type Periodo } from "@/lib/calendario/periodo";
import { agruparPorDia } from "@/lib/calendario/semana";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { Agenda } from "../_calendario/agenda";
import { BotaoNovoPrazo, PrazosProvider } from "../_calendario/editor-prazo";
import { GradeMes } from "../_calendario/grade-mes";
import { GradeSemana } from "../_calendario/grade-semana";
import { NavPeriodo, SeletorPeriodo } from "../_calendario/nav-periodo";
import { SeletorVisao } from "../_calendario/seletor-visao";

export const metadata = { title: "Calendário" };

type Param = string | string[] | undefined;
type Busca = { periodo?: Param; data?: Param; semana?: Param; ver?: Param; pessoa?: Param };
const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Calendário (GAB-51, etapa 1): próximas ações dos cards abertos + prazos, do
 * período visível (`?periodo=` mes | 15d | semana; padrão mês). Estrutura do
 * calendário do ICS (agenda de 220px à esquerda, grade, legenda no pé), no
 * visual do CRM e sem régua de horas. Semana: 7 colunas ≥ 840px; mês e 15
 * dias: grade mensal compacta.
 */
export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const busca = await searchParams;
  const agora = new Date();
  const periodo = periodoDaBusca({ periodo: um(busca.periodo), data: um(busca.data), semana: um(busca.semana) }, agora);
  const dados = await comTratamento("pagina.calendario", async () => {
    const visao = await resolverVisao(ator, { ver: um(busca.ver), pessoa: um(busca.pessoa) });
    const itens = await carregarItens(visao.filtro, { primeiroDia: periodo.primeiroDia, ultimoDia: periodo.ultimoDia, hoje: periodo.hoje }, ator);
    return { visao, itens };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { visao, itens } = dados;
  const dias = agruparPorDia(periodo.dias, itens.acoes, itens.prazos);
  const grade = agruparPorDia(periodo.grade, itens.acoes, itens.prazos);
  const gestor = temPapelMinimo(ator.papel, "GESTOR");
  const time = visao.modo === "time";

  const href = (p: Periodo, ref: string | null) => {
    const q = new URLSearchParams();
    if (time) q.set("ver", "time");
    if (visao.modo === "pessoa" && visao.pessoa) q.set("pessoa", visao.pessoa.id);
    for (const [k, v] of Object.entries(paramsDoPeriodo(p, ref))) q.set(k, v);
    const s = q.toString();
    return s ? `/calendario?${s}` : "/calendario";
  };
  const { primeiroDia, ultimoDia } = periodo;
  const de = visao.modo === "time" ? "time" : visao.modo === "pessoa" && visao.pessoa ? visao.pessoa.nome : "meu";

  return (
    <PrazosProvider
      eu={{ id: ator.id, nome: ator.nome }}
      gestor={gestor}
      responsaveis={visao.opcoes}
      responsavelPadrao={visao.modo === "pessoa" && visao.pessoa ? visao.pessoa.id : ator.id}
    >
      <div data-testid="calendario" className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Calendário · {de}</p>
            <h1 className="font-mono text-2xl font-semibold tracking-tight tabular md:text-3xl">{periodo.rotulo}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SeletorPeriodo atual={periodo.periodo} href={(p) => href(p, null)} />
            <SeletorVisao modo={visao.modo} pessoaId={visao.pessoa?.id ?? null} eu={ator.id} opcoes={visao.opcoes} periodo={paramsDoPeriodo(periodo.periodo, periodo.ref)} />
            <NavPeriodo periodo={periodo} href={(ref) => href(periodo.periodo, ref)} />
            <BotaoNovoPrazo dia={periodo.atual ? periodo.hoje : periodo.primeiroDia} />
          </div>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div data-testid="calendario-agenda" className="border-b border-border pb-5 lg:border-r lg:border-b-0 lg:pr-5 lg:pb-0">
            <Agenda dias={dias} hoje={periodo.hoje} rotulo={periodo.rotuloAgenda} vazio={periodo.periodo === "semana" ? "Nada nesta semana." : "Nada neste período."} />
          </div>
          <div className="min-w-0">
            {periodo.periodo === "semana" ? (
              <GradeSemana dias={dias} hoje={periodo.hoje} mostrarResponsavelNoPrazo={time} />
            ) : (
              <GradeMes dias={grade} hoje={periodo.hoje} inicio={primeiroDia} fim={ultimoDia} mostrarResponsavel={time} />
            )}
            <Legenda />
          </div>
        </div>
      </div>
    </PrazosProvider>
  );
}
