import Link from "next/link";
import { cn } from "cn";
import { Chip, Painel, Tabela, Tile, Tiles, diaBR } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { naMeta, progresso } from "@/lib/gg/modelo";
import { ehEditorGG } from "@/lib/gg/organizacao";
import { diaEmFuso } from "@/lib/projetos/aging";
import { carregarMetas, ehFonteCrm, FONTES_CRM } from "@/lib/gg/rotina";
import { AtualizarKr, ConcluirIniciativa, Medir, NovaMeta } from "./acoes-metas";

export const metadata = { title: "Metas · G&G" };

const ABAS = [
  ["objetivos", "Objetivos / OKRs"],
  ["kpis", "Indicadores (KPIs)"],
  ["iniciativas", "Iniciativas"],
  ["ciclos", "Ciclos"],
] as const;

/** Linha de tendência no padrão dos painéis do CRM: área suave, último ponto em destaque. */
function Sparkline({ valores }: { valores: number[] }) {
  if (valores.length < 2) return <span className="text-xs text-fg-faint">poucas medições</span>;
  const w = 120,
    h = 32,
    p = 3;
  const mx = Math.max(...valores),
    mn = Math.min(...valores, 0);
  const pts = valores.map((v, i) => [p + (i * (w - 2 * p)) / (valores.length - 1), h - p - ((v - mn) / (mx - mn || 1)) * (h - 2 * p)]);
  const d = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");
  const ult = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-[120px]" aria-hidden>
      <path d={`${d} L${ult[0]} ${h - p} L${pts[0][0]} ${h - p}Z`} className="fill-primary/15" />
      <path d={d} className="fill-none stroke-primary" strokeWidth={1.6} />
      <circle cx={ult[0]} cy={ult[1]} r={2.6} className="fill-primary" />
    </svg>
  );
}

export default async function MetasPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const ator = await exigirUsuario();
  const { aba = "objetivos" } = await searchParams;
  const [m, editor] = await Promise.all([carregarMetas(), ehEditorGG(ator)]);
  const krs = m.objetivos.flatMap((o) => o.resultados);
  const media = krs.length ? Math.round(krs.reduce((s, k) => s + progresso(k.inicial, k.meta, k.atual), 0) / krs.length) : 0;
  const automaticos = m.kpis.filter((k) => k.fonte).length + krs.filter((k) => k.fonte).length;
  // Dia de São Paulo, como o servidor valida (UTC já é amanhã depois das 21h).
  const hoje = diaEmFuso(new Date());
  const fontes = Object.entries(FONTES_CRM).map(([k, v]) => ({ id: k, nome: v.rotulo }));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · planejamento" title="Metas e planejamento" description="Defina metas, acompanhe resultados e organize iniciativas." />
      <Tiles>
        <Tile rotulo="Objetivos" valor={m.objetivos.length} />
        <Tile rotulo="Resultados-chave" valor={krs.length} />
        <Tile rotulo="Progresso médio dos KRs" valor={`${media}%`} nota="média simples dos KRs cadastrados" />
        <Tile rotulo="Medidos pelo CRM" valor={automaticos} nota="atualizam sozinhos pelo cron" />
      </Tiles>
      <div className="grid gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-sm sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <span>
          <span className="block text-xs text-fg-mute">Estratégico</span>Objetivos e resultados-chave
        </span>
        <span className="hidden text-fg-faint sm:block">→</span>
        <span>
          <span className="block text-xs text-fg-mute">Tático</span>KPIs e medições
        </span>
        <span className="hidden text-fg-faint sm:block">→</span>
        <span>
          <span className="block text-xs text-fg-mute">Operacional</span>Iniciativas
        </span>
      </div>
      <nav aria-label="Seções" className="flex flex-wrap gap-2">
        {ABAS.map(([k, n]) => (
          <Link key={k} href={`?aba=${k}`} aria-current={aba === k ? "page" : undefined} className={cn("rounded-lg border px-3.5 py-2 text-sm", aba === k ? "border-primary/50 bg-primary-soft/50 text-primary" : "border-border-strong text-fg-soft hover:text-foreground")}>
            {n}
          </Link>
        ))}
        {editor ? <NovaMeta aba={aba} ciclos={m.ciclos.map((c) => ({ id: c.id, nome: c.nome }))} objetivos={m.objetivos.map((o) => ({ id: o.id, nome: o.titulo }))} kpis={m.kpis.map((k) => ({ id: k.id, nome: k.titulo }))} membros={m.membros} fontes={fontes} /> : null}
      </nav>

      {aba === "ciclos" ? (
        <Painel titulo="Ciclos" contagem={m.ciclos.length}>
          <Tabela colunas={["Ciclo", "Início", "Fim", "Objetivos"]} vazio={m.ciclos.length ? undefined : "Crie o primeiro ciclo (ex.: 2026.2)."}>
            {m.ciclos.map((c) => (
              <tr key={c.id}>
                <td>{c.nome}</td>
                <td className="font-mono text-xs">{diaBR(c.inicio)}</td>
                <td className="font-mono text-xs">{diaBR(c.fim)}</td>
                <td className="font-mono">{m.objetivos.filter((o) => o.cicloId === c.id).length}</td>
              </tr>
            ))}
          </Tabela>
        </Painel>
      ) : aba === "kpis" ? (
        <Painel titulo="Indicadores (KPIs)" contagem={m.kpis.length}>
          <Tabela colunas={["KPI", "Últimas medições", "Atual", "Meta", "Fonte", ""]} vazio={m.kpis.length ? undefined : "Nenhum KPI ainda."}>
            {m.kpis.map((k) => {
              const atual = k.medicoes.at(-1)?.valor ?? null;
              return (
                <tr key={k.id}>
                  <td>
                    {k.titulo}
                    <span className="block text-xs text-fg-faint">{k.direcao === "MAIOR" ? "quanto maior, melhor" : "quanto menor, melhor"}</span>
                  </td>
                  <td>
                    <Sparkline valores={k.medicoes.map((x) => x.valor)} />
                  </td>
                  <td className="font-mono tabular">
                    <b>{atual ?? "—"}</b> {k.unidade}
                  </td>
                  <td className="font-mono tabular">{k.meta}</td>
                  <td>{ehFonteCrm(k.fonte) ? <span title={FONTES_CRM[k.fonte].descricao}><Chip tom="coral">CRM, automático</Chip></span> : <Chip>manual</Chip>}</td>
                  <td className="text-right">{k.fonte ? atual !== null ? <Chip tom={naMeta(k.direcao, atual, k.meta) ? "ok" : "aviso"}>{naMeta(k.direcao, atual, k.meta) ? "na meta" : "fora da meta"}</Chip> : null : editor ? <Medir kpiId={k.id} hoje={hoje} /> : null}</td>
                </tr>
              );
            })}
          </Tabela>
        </Painel>
      ) : aba === "iniciativas" ? (
        <Painel titulo="Iniciativas" contagem={m.iniciativas.length}>
          <Tabela colunas={["Iniciativa", "Ligada a", "Responsável", "Prazo", ""]} vazio={m.iniciativas.length ? undefined : "Nenhuma iniciativa ainda."}>
            {m.iniciativas.map((i) => (
              <tr key={i.id} className={i.concluida ? "opacity-60" : ""}>
                <td>{i.titulo}</td>
                <td className="text-fg-mute">{i.objetivo ?? i.kpi ?? "—"}</td>
                <td>{i.responsavel}</td>
                <td className="font-mono text-xs">{diaBR(i.prazo)}</td>
                <td className="text-right">{editor ? <ConcluirIniciativa id={i.id} concluida={i.concluida} /> : <Chip tom={i.concluida ? "ok" : "gg"}>{i.concluida ? "concluída" : "em andamento"}</Chip>}</td>
              </tr>
            ))}
          </Tabela>
        </Painel>
      ) : m.objetivos.length ? (
        m.objetivos.map((o) => (
          <Painel key={o.id} titulo={o.titulo} acoes={<span className="text-xs text-fg-mute">{o.responsavel} · {o.ciclo}</span>}>
            <Tabela colunas={["Resultado-chave", "Inicial", "Atual", "Meta", "Progresso", "Fonte"]} vazio={o.resultados.length ? undefined : "Sem resultados-chave."}>
              {o.resultados.map((k) => {
                const pr = progresso(k.inicial, k.meta, k.atual);
                return (
                  <tr key={k.id}>
                    <td>{k.titulo}</td>
                    <td className="font-mono tabular">{k.inicial}</td>
                    <td className="font-mono tabular">{editor && !k.fonte ? <AtualizarKr id={k.id} atual={k.atual} /> : <b>{k.atual}</b>}</td>
                    <td className="font-mono tabular">
                      {k.meta} {k.unidade}
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-strong">
                          <span className="block h-full bg-primary" style={{ width: `${pr}%` }} />
                        </span>
                        <span className="font-mono text-xs">{pr}%</span>
                      </span>
                    </td>
                    <td>{ehFonteCrm(k.fonte) ? <span title={FONTES_CRM[k.fonte].descricao}><Chip tom="coral">CRM, automático</Chip></span> : <Chip>manual</Chip>}</td>
                  </tr>
                );
              })}
            </Tabela>
          </Painel>
        ))
      ) : (
        <Painel>
          <p className="px-4 py-6 text-sm text-fg-faint">Nenhum objetivo ainda. Comece por um ciclo (aba Ciclos), depois crie o objetivo e os resultados-chave.</p>
        </Painel>
      )}
    </div>
  );
}
