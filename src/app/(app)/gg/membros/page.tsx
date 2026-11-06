import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { CAMPO, Chip, Painel, Tabela, Tile, Tiles } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { db } from "@/lib/db";
import { descendentes, normalizar, ROTULO_STATUS_MEMBRO, STATUS_MEMBRO } from "@/lib/gg/modelo";
import { carregarBase, derivadoDe, ehEditorGG, postosDe } from "@/lib/gg/organizacao";
import { cargaPorPessoa } from "@/lib/projetos/equipe";
import { AcoesMembros } from "./acoes-membros";

export const metadata = { title: "Membros · G&G" };

const TOM_STATUS = { ATIVO: "ok", AFASTADO: "aviso", INATIVO: "perigo", NAO_INFORMADO: "neutro" } as const;

/** Toda pessoa da IJ, com ou sem conta no CRM. Filtros por GET (link para um colega). */
export default async function MembrosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ator = await exigirUsuario();
  const f = await searchParams;
  const [base, editor, contas] = await Promise.all([carregarBase(), ehEditorGG(ator), db.usuario.findMany({ select: { id: true, papel: true, area: true, cargos: true, ativo: true } })]);
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const carga = await cargaPorPessoa(base.membros.flatMap((m) => (m.usuarioId ? [m.usuarioId] : [])));
  const alcance = f.area ? descendentes(base.areas, f.area) : null;
  const busca = normalizar(f.q ?? "");
  const lista = base.membros.filter((m) => {
    const ps = postosDe(base, m.id);
    return normalizar(`${m.nome} ${m.email ?? ""}`).includes(busca) && (!alcance || ps.some((p) => alcance.has(p.areaId))) && (!f.status || m.status === f.status);
  });
  const ativos = base.membros.filter((m) => m.status === "ATIVO");
  const semPosicao = ativos.filter((m) => !postosDe(base, m.id).length).length;
  const comConta = base.membros.filter((m) => m.usuarioId).length;
  const difere = base.membros.filter((m) => {
    const c = m.usuarioId ? contaPorId.get(m.usuarioId) : null;
    const d = derivadoDe(base, m.id);
    return c && d.papel && !d.conflito && c.papel !== "ADMIN" && (c.papel !== d.papel || c.area !== d.area || c.cargos.includes("GP") !== d.gp);
  }).length;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · membros" title="Membros" description="Toda pessoa da IJ, com ou sem conta no CRM. A área e o papel no CRM saem do organograma." actions={editor ? <AcoesMembros /> : null} />
      <Tiles>
        <Tile rotulo="Membros ativos" valor={ativos.length} />
        <Tile rotulo="Com conta no CRM" valor={comConta} nota={`${base.membros.length - comConta} sem conta`} />
        <Tile rotulo="Sem posição no organograma" valor={semPosicao} nota="ativos que precisam de lugar" />
        <Tile rotulo="Conta difere do organograma" valor={difere} nota="ajuste na ficha" />
      </Tiles>
      <Painel>
        <form className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_14rem_12rem_auto] sm:items-end" action="/gg/membros">
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Buscar nome ou e-mail
            <input name="q" defaultValue={f.q ?? ""} className={CAMPO} />
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Área
            <select name="area" defaultValue={f.area ?? ""} className={CAMPO}>
              <option value="">Todas</option>
              {base.areas
                .filter((a) => a.tipo !== "FRENTE")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Status
            <select name="status" defaultValue={f.status ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {STATUS_MEMBRO.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS_MEMBRO[s]}
                </option>
              ))}
            </select>
          </label>
          <button className="h-8 rounded-lg border border-border-strong px-3 text-sm hover:bg-surface-hover">Filtrar</button>
        </form>
      </Painel>
      <Painel titulo="Pessoas" contagem={lista.length}>
        <Tabela colunas={["Pessoa", "Posições atuais", "No CRM", "Carga", "Status"]} vazio={lista.length ? undefined : "Nenhum membro com esses filtros."}>
          {lista.map((m) => {
            const ps = postosDe(base, m.id);
            const d = derivadoDe(base, m.id);
            const c = m.usuarioId ? carga.get(m.usuarioId) : null;
            return (
              <tr key={m.id} className="hover:bg-surface-hover">
                <td>
                  <Link href={`/gg/membros/${m.id}`} className="flex items-center gap-2.5 hover:underline">
                    <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
                    <span className="grid">
                      <span>{m.nome}</span>
                      <span className="font-mono text-[11px] text-fg-faint">{m.email ?? "sem e-mail"}</span>
                    </span>
                  </Link>
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">{ps.length ? ps.map((p) => <Chip key={p.ocupacao.id}>{p.nome}</Chip>) : <span className="text-fg-faint">sem posição</span>}</span>
                </td>
                <td>
                  {d.conflito ? <Chip tom="aviso">duas áreas</Chip> : d.area ? <Chip tom="coral">{d.area}{d.gp ? " · GP" : ""}</Chip> : null}{" "}
                  {m.usuarioId ? <Chip tom="ok">conta</Chip> : <span className="text-xs text-fg-faint">sem conta</span>}
                </td>
                <td className="font-mono text-xs text-fg-mute">{c ? `${c.projetos} proj · ${c.tarefas} tarefas` : "—"}</td>
                <td>
                  <Chip tom={TOM_STATUS[m.status]}>{ROTULO_STATUS_MEMBRO[m.status]}</Chip>
                </td>
              </tr>
            );
          })}
        </Tabela>
      </Painel>
    </div>
  );
}
