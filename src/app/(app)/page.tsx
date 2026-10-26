import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { diaEmFuso } from "@/lib/oportunidades/aging";
import { carregarSemana, resolverVendedor } from "@/lib/semana/semana";
import { Destaque, Grupo } from "./_semana/itens";
import { SeletorVendedor } from "./_semana/seletor-vendedor";

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

/** Minha Semana (GAB-33, §4.5): próximas ações do vendedor, padrão "Today" do ics-select. */
export default async function MinhaSemanaPage({ searchParams }: { searchParams: Promise<{ vendedor?: string | string[] }> }) {
  const ator = await exigirUsuario();
  const { vendedor } = await searchParams;
  const escolha = await resolverVendedor(ator, typeof vendedor === "string" ? vendedor : undefined);
  const agora = new Date();
  const hoje = diaEmFuso(agora);
  const s = await carregarSemana(escolha.alvo.id, agora);
  const proprio = escolha.alvo.id === ator.id;
  const primeiroNome = escolha.alvo.nome.split(" ")[0];
  const nada = s.destaque === null && s.sem.length === 0;

  // Totais incluem o destaque; a lista da faixa dele mostra o resto.
  const soDestaque = (faixa: "vencida" | "hoje" | "semana") => s.destaqueFaixa === faixa;

  return (
    <>
      <PageHeader
        eyebrow={hojeExtenso.format(agora)}
        title={proprio ? saudacao(agora) : `Semana de ${escolha.alvo.nome}`}
        description={
          proprio
            ? "Suas próximas ações nos cards abertos em que você é responsável."
            : `Próximas ações dos cards abertos em que ${primeiroNome} é responsável.`
        }
        actions={escolha.podeTrocar ? <SeletorVendedor atualId={escolha.alvo.id} proprioId={ator.id} opcoes={escolha.opcoes} /> : undefined}
      />

      <div className="space-y-8">
        {s.destaque && s.destaqueFaixa ? (
          <Destaque c={s.destaque} faixa={s.destaqueFaixa} agora={agora} hoje={hoje} />
        ) : (
          <section className="rounded-xl border border-border bg-surface p-5 md:p-6">
            <p className="eyebrow mb-3 flex items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              tudo em dia
            </p>
            <p className="text-2xl font-semibold tracking-tight">Nada vencido, nada para hoje.</p>
            <p className="mt-2 text-sm text-fg-mute">
              {nada
                ? proprio
                  ? "Você não tem cards abertos agora. Crie um no Kanban quando surgir um lead."
                  : `${primeiroNome} não tem cards abertos agora.`
                : "Nenhuma próxima ação nos próximos 7 dias. Bom momento para revisar os cards sem próxima ação abaixo."}
            </p>
          </section>
        )}

        {s.totais.vencida === 0 && s.destaque ? (
          <p className="flex items-center gap-2 text-sm text-fg-soft">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Nada vencido. Bom trabalho.
          </p>
        ) : null}

        {s.totais.vencida > 0 ? (
          <Grupo titulo="Vencidas" total={s.totais.vencida} cor="bg-danger" itens={s.vencidas} agora={agora} hoje={hoje} vazio="Só a do destaque, acima." />
        ) : null}
        <Grupo
          titulo="Hoje"
          total={s.totais.hoje}
          cor="bg-warn"
          itens={s.hoje}
          agora={agora}
          hoje={hoje}
          vazio={soDestaque("hoje") ? "Só a do destaque, acima." : "Nada marcado para hoje."}
        />
        <Grupo
          titulo="Próximos 7 dias"
          total={s.totais.semana}
          cor="bg-success"
          itens={s.semana}
          agora={agora}
          hoje={hoje}
          vazio={soDestaque("semana") ? "Só a do destaque, acima." : "Nada nos próximos 7 dias."}
        />
        <Grupo
          titulo="Sem próxima ação"
          total={s.totais.sem}
          cor="bg-fg-faint"
          itens={s.sem}
          agora={agora}
          hoje={hoje}
          vazio="Todos os cards abertos têm próxima ação."
        />

        {s.depois > 0 ? (
          <p className="font-mono text-xs text-fg-mute">
            +{s.depois} {s.depois === 1 ? "card" : "cards"} com próxima ação depois de 7 dias ·{" "}
            <Link href={`/kanban?resp=${encodeURIComponent(escolha.alvo.id)}`} className="text-fg-soft hover:text-foreground hover:underline">
              ver no Kanban
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
