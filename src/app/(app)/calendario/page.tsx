import { ErroCarregamento } from "@/components/erro-carregamento";
import { Legenda } from "@/components/calendario/legenda";
import { exigirUsuario } from "@/lib/auth/atual";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { carregarItensDaSemana, resolverVisao } from "@/lib/calendario/calendario";
import { agruparPorDia, resolverSemana } from "@/lib/calendario/semana";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { Agenda } from "../_calendario/agenda";
import { BotaoNovoPrazo, PrazosProvider } from "../_calendario/editor-prazo";
import { GradeSemana } from "../_calendario/grade-semana";
import { NavSemana } from "../_calendario/nav-semana";
import { SeletorVisao } from "../_calendario/seletor-visao";

export const metadata = { title: "Calendário" };

type Busca = { semana?: string | string[]; ver?: string | string[]; pessoa?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Calendário (GAB-51, etapa 1): próximas ações dos cards abertos + prazos, da
 * semana visível. Estrutura e medidas do calendário do ICS (agenda de 220px à
 * esquerda, grade de 7 colunas ≥ 840px, legenda no pé), no visual do CRM e
 * sem régua de horas.
 */
export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const busca = await searchParams;
  const agora = new Date();
  const semana = resolverSemana(um(busca.semana), agora);
  const dados = await comTratamento("pagina.calendario", async () => {
    const visao = await resolverVisao(ator, { ver: um(busca.ver), pessoa: um(busca.pessoa) });
    const itens = await carregarItensDaSemana(visao.filtro, semana, ator);
    return { visao, itens };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { visao, itens } = dados;
  const dias = agruparPorDia(semana.dias, itens.acoes, itens.prazos);
  const gestor = temPapelMinimo(ator.papel, "GESTOR");
  const semanaUrl = semana.atual ? null : semana.segunda;

  const href = (segunda: string | null) => {
    const q = new URLSearchParams();
    if (visao.modo === "time") q.set("ver", "time");
    if (visao.modo === "pessoa" && visao.pessoa) q.set("pessoa", visao.pessoa.id);
    if (segunda) q.set("semana", segunda);
    const s = q.toString();
    return s ? `/calendario?${s}` : "/calendario";
  };
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
            <h1 className="font-mono text-2xl font-semibold tracking-tight tabular md:text-3xl">{semana.rotulo}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SeletorVisao modo={visao.modo} pessoaId={visao.pessoa?.id ?? null} eu={ator.id} opcoes={visao.opcoes} semana={semanaUrl} />
            <NavSemana semana={semana} href={href} />
            <BotaoNovoPrazo dia={semana.atual ? semana.hoje : semana.segunda} />
          </div>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div data-testid="calendario-agenda" className="border-b border-border pb-5 lg:border-r lg:border-b-0 lg:pr-5 lg:pb-0">
            <Agenda dias={dias} hoje={semana.hoje} />
          </div>
          <div className="min-w-0">
            <GradeSemana dias={dias} hoje={semana.hoje} mostrarResponsavelNoPrazo={visao.modo === "time"} />
            <Legenda />
          </div>
        </div>
      </div>
    </PrazosProvider>
  );
}
