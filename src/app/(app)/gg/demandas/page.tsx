import { CAMPO, Chip, Painel, Tabela, Tile, Tiles, diaBR } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { LIMITE_DEMANDA, normalizar, semestreDe } from "@/lib/gg/modelo";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { listarDemandas } from "@/lib/gg/rotina";
import { Cancelar, RegistrarDemanda } from "./registrar";

export const metadata = { title: "Demandas · G&G" };

/** Registros Rosa/Azul com assinatura. Limites: 2 rosas e 3 azuis por membro e semestre. */
export default async function DemandasPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; semestre?: string }> }) {
  const ator = await exigirUsuario();
  const f = await searchParams;
  const [base, editor, todas] = await Promise.all([carregarBase(), ehEditorGG(ator), listarDemandas()]);
  const semestre = semestreDe(base.hoje);
  const sem = f.semestre ?? semestre;
  const q = normalizar(f.q ?? "");
  const lista = todas.filter((d) => (!f.tipo || d.tipo === f.tipo) && (!sem || d.semestre === sem) && normalizar(`${d.membro} ${d.justificativa}`).includes(q));
  const vivas = todas.filter((d) => d.semestre === semestre && !d.cancelada);
  const saldo = (membroId: string, tipo: "ROSA" | "AZUL") => vivas.filter((d) => d.membroId === membroId && d.tipo === tipo).length;
  const noLimite = base.membros.filter((m) => saldo(m.id, "AZUL") >= LIMITE_DEMANDA.AZUL || saldo(m.id, "ROSA") >= LIMITE_DEMANDA.ROSA).length;
  const semestres = [...new Set([semestre, ...todas.map((d) => d.semestre)])].sort().reverse();
  const membros = base.membros.filter((m) => m.status !== "INATIVO").map((m) => ({ id: m.id, nome: m.nome, rosa: saldo(m.id, "ROSA"), azul: saldo(m.id, "AZUL") }));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · demandas" title="Demandas" description="Registros Rosa/Azul, justificativa e assinatura." />
      <p className="rounded-xl border border-primary/35 bg-primary-soft/30 px-4 py-3 text-sm text-fg-soft">
        Registre a pessoa, Rosa ou Azul e a justificativa. A assinatura e a data vêm da sua conta. Limites: {LIMITE_DEMANDA.ROSA} rosas e {LIMITE_DEMANDA.AZUL} azuis por membro e semestre; cancelar libera a vaga.
      </p>
      <Tiles>
        <Tile rotulo={`Rosas em ${semestre}`} valor={vivas.filter((d) => d.tipo === "ROSA").length} />
        <Tile rotulo={`Azuis em ${semestre}`} valor={vivas.filter((d) => d.tipo === "AZUL").length} />
        <Tile rotulo="Registros" valor={todas.length} />
        <Tile rotulo="No limite" valor={noLimite} nota="não recebem outra do mesmo tipo no semestre" />
      </Tiles>
      {editor ? <RegistrarDemanda membros={membros} /> : null}
      <Painel>
        <form action="/gg/demandas" className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end">
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Buscar pessoa ou justificativa
            <input name="q" defaultValue={f.q ?? ""} className={CAMPO} />
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Tipo
            <select name="tipo" defaultValue={f.tipo ?? ""} className={CAMPO}>
              <option value="">Rosas e azuis</option>
              <option value="ROSA">Rosas</option>
              <option value="AZUL">Azuis</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Semestre
            <select name="semestre" defaultValue={sem} className={CAMPO}>
              <option value="">Todos</option>
              {semestres.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="h-8 rounded-lg border border-border-strong px-3 text-sm hover:bg-surface-hover">Filtrar</button>
        </form>
      </Painel>
      <Painel titulo="Demandas Rosa/Azul" contagem={lista.length}>
        <Tabela colunas={["Pessoa", "Tipo", "Justificativa", "Registrado por", "Data", ""]} vazio={lista.length ? undefined : "Nenhuma demanda com esses filtros."}>
          {lista.map((d) => (
            <tr key={d.id} className={d.cancelada ? "opacity-60" : ""}>
              <td>{d.membro}</td>
              <td>
                <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${d.tipo === "ROSA" ? "border-pink-400/50 bg-pink-400/10 text-pink-300" : "border-chart-4/50 bg-chart-4/10 text-chart-4"}`}>{d.tipo === "ROSA" ? "Rosa" : "Azul"}</span>
              </td>
              <td className="max-w-md">{d.justificativa}</td>
              <td className="text-fg-mute">{d.registrante}</td>
              <td className="font-mono text-xs">{diaBR(d.em)}</td>
              <td className="text-right">{d.cancelada ? <Chip>cancelada</Chip> : editor ? <Cancelar id={d.id} rotulo={`Cancelar a demanda ${d.tipo === "ROSA" ? "rosa" : "azul"} de ${d.membro}`} /> : null}</td>
            </tr>
          ))}
        </Tabela>
      </Painel>
    </div>
  );
}
