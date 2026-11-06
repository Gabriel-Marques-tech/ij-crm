import Link from "next/link";
import { cn } from "cn";
import { Chip, Painel, Tabela, diaBR } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { ROTULO_EVENTO } from "@/lib/gg/modelo";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { listarAusencias, listarEventos } from "@/lib/gg/rotina";
import { somarDias } from "@/lib/projetos/proxima-acao";
import { DiaAgenda, RegistrarAusencia } from "./acoes-agenda";

export const metadata = { title: "Agenda · G&G" };

const COR = { RG: "border-primary/50 text-primary", REUNIAO: "border-chart-5/50 text-chart-5", EVENTO: "border-warn/50 text-warn" } as const;

/** Calendário do mês (RG, reunião, evento) e faltas. Só ausências são registradas; ninguém é marcado presente. */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ mes?: string; aba?: string }> }) {
  const ator = await exigirUsuario();
  const f = await searchParams;
  const [base, editor] = await Promise.all([carregarBase(), ehEditorGG(ator)]);
  const mes = /^\d{4}-\d{2}$/.test(f.mes ?? "") ? f.mes! : base.hoje.slice(0, 7);
  const primeiro = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const ultimo = `${mes}-${String(dias).padStart(2, "0")}`;
  const inicioSemana = new Date(`${primeiro}T12:00:00Z`).getUTCDay();
  const [eventos, ausencias] = await Promise.all([listarEventos(primeiro, ultimo), f.aba === "ausencias" ? listarAusencias(ator) : Promise.resolve([])]);
  const passados = editor ? await listarEventos(somarDias(base.hoje, -120), base.hoje) : [];
  const mesAnt = somarDias(primeiro, -1).slice(0, 7);
  const mesSeg = somarDias(ultimo, 1).slice(0, 7);
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${primeiro}T12:00:00Z`));
  const areas = base.areas.filter((x) => x.tipo !== "INSTITUCIONAL").map((x) => ({ id: x.id, nome: x.nome }));
  const membros = base.membros.filter((x) => x.status !== "INATIVO").map((x) => ({ id: x.id, nome: x.nome }));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · agenda" title="Agenda e ausências" description="Calendário de reuniões, RGs e eventos, e o registro de ausências." />
      <nav aria-label="Seções" className="flex gap-2">
        {[
          ["", "Calendário"],
          ["ausencias", "Ausências"],
        ].map(([k, n]) => (
          <Link key={k} href={k ? `?aba=${k}` : `?mes=${mes}`} aria-current={(f.aba ?? "") === k ? "page" : undefined} className={cn("rounded-lg border px-3.5 py-2 text-sm", (f.aba ?? "") === k ? "border-primary/50 bg-primary-soft/50 text-primary" : "border-border-strong text-fg-soft hover:text-foreground")}>
            {n}
          </Link>
        ))}
        {editor && f.aba === "ausencias" ? <RegistrarAusencia eventos={passados.map((e) => ({ id: e.id, nome: `${diaBR(e.data)} · ${e.titulo}` }))} membros={membros} /> : null}
      </nav>

      {f.aba === "ausencias" ? (
        <Painel titulo="Ausências registradas" contagem={ausencias.length}>
          <Tabela colunas={["Evento", "Data", "Quem faltou", "Situação", "Observação"]} vazio={ausencias.length ? undefined : editor ? "Nenhuma ausência registrada." : "Você não tem faltas registradas."}>
            {ausencias.map((x) => (
              <tr key={x.id}>
                <td>{x.evento}</td>
                <td className="font-mono text-xs">{diaBR(x.data)}</td>
                <td>{x.membro}</td>
                <td>
                  <Chip tom={x.justificada ? "ok" : "aviso"}>{x.justificada ? "Justificada" : "Não justificada"}</Chip>
                </td>
                <td className="text-fg-mute">{x.observacao ?? "—"}</td>
              </tr>
            ))}
          </Tabela>
        </Painel>
      ) : (
        <Painel
          titulo={`Agenda de ${nomeMes}`}
          acoes={
            <span className="flex items-center gap-1 text-sm">
              <Link href={`?mes=${mesAnt}`} className="rounded-md px-2 py-1 hover:bg-surface-hover" aria-label="Mês anterior">
                ‹
              </Link>
              <Link href="?" className="rounded-md px-2 py-1 hover:bg-surface-hover">
                Hoje
              </Link>
              <Link href={`?mes=${mesSeg}`} className="rounded-md px-2 py-1 hover:bg-surface-hover" aria-label="Próximo mês">
                ›
              </Link>
              <Chip tom="coral">RG</Chip>
              <Chip tom="gg">reunião</Chip>
              <Chip tom="aviso">evento</Chip>
            </span>
          }
        >
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-7 gap-1.5 p-4">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                <div key={d} className="pb-1 text-center text-xs font-semibold text-fg-soft">
                  {d}
                </div>
              ))}
              {Array.from({ length: inicioSemana }, (_, i) => (
                <div key={`v${i}`} />
              ))}
              {Array.from({ length: dias }, (_, i) => {
                const dia = `${mes}-${String(i + 1).padStart(2, "0")}`;
                const evs = eventos.filter((e) => e.data === dia);
                return (
                  <DiaAgenda key={dia} dia={dia} numero={i + 1} hoje={dia === base.hoje} editor={editor} areas={areas}>
                    {evs.map((e) => (
                      <span key={e.id} title={`${e.titulo}${e.area ? ` · ${e.area}` : " · IJ inteira"}`} className={cn("block truncate rounded border bg-surface-strong px-1.5 py-0.5 text-[11px]", COR[e.categoria])}>
                        {e.horario ? `${e.horario} ` : ""}
                        {e.titulo}
                      </span>
                    ))}
                  </DiaAgenda>
                );
              })}
            </div>
          </div>
          <p className="border-t border-border px-4 py-2.5 text-xs text-fg-faint">
            {editor ? "Clique num dia para criar um evento. " : ""}Eventos com área aparecem na Minha Semana de quem é da área; sem área, para a IJ inteira. Lembrete no sino 2 dias antes. {ROTULO_EVENTO.RG} sempre vai para todos.
          </p>
        </Painel>
      )}
    </div>
  );
}
