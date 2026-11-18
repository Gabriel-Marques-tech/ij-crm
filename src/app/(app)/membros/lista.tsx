import Link from "next/link";
import type { Papel } from "@prisma/client";
import { Avatar } from "@/components/avatar";
import { CAMPO, Chip, Painel, Tabela, Tile, Tiles } from "@/components/gg/ui";
import { db } from "@/lib/db";
import { ROTULO_CARGO } from "@/lib/auth/areas";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { contaDifere, ROTULO_STATUS_MEMBRO, STATUS_MEMBRO } from "@/lib/gg/modelo";
import { filtrarMembros, HREF_MEMBROS, type FiltrosMembros } from "@/lib/gg/membros";
import { derivadoDe, postosDe, type BaseOrg } from "@/lib/gg/organizacao";
import { cargaPorPessoa } from "@/lib/projetos/equipe";

export const TOM_STATUS = { ATIVO: "ok", AFASTADO: "aviso", INATIVO: "perigo", NAO_INFORMADO: "neutro" } as const;

/**
 * Lista de membros (visão `lista`). Filtros por GET: área (com as frentes), cargo, status e busca.
 * Quem edita G&G ou é da gestão vê também e-mail, conta do CRM e carga; os demais, nome, posições
 * (área e cargo) e status, e a busca não olha o e-mail.
 */
export async function ListaMembros({ ator, base, editor, filtros }: { ator: { id: string; papel: Papel }; base: BaseOrg; editor: boolean; filtros: FiltrosMembros }) {
  const completo = editor || temPapelMinimo(ator.papel, "GESTOR");
  const lista = filtrarMembros(base, filtros, { buscaEmail: completo });
  const [contas, carga] = completo
    ? await Promise.all([db.usuario.findMany({ select: { id: true, papel: true, area: true, cargos: true } }), cargaPorPessoa(base.membros.flatMap((m) => (m.usuarioId ? [m.usuarioId] : [])))])
    : [[], new Map()];
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const ativos = base.membros.filter((m) => m.status === "ATIVO");
  const semPosicao = ativos.filter((m) => !postosDe(base, m.id).length).length;
  const comConta = base.membros.filter((m) => m.usuarioId).length;
  const difere = base.membros.filter((m) => {
    const c = m.usuarioId ? contaPorId.get(m.usuarioId) : null;
    return c && contaDifere(c, derivadoDe(base, m.id));
  }).length;
  const areaDe = (id: string) => base.areas.find((a) => a.id === id);
  const cargoDe = (id: string) => base.cargos.find((c) => c.id === id);
  // Áreas de topo e, logo abaixo, as frentes delas (indentadas): a área inclui as frentes no filtro.
  const opcoesArea = base.areas
    .filter((a) => !a.superiorId)
    .flatMap((a) => [{ id: a.id, nome: a.nome }, ...base.areas.filter((f) => f.superiorId === a.id).map((f) => ({ id: f.id, nome: `  ${f.nome}` }))]);
  const filtrando = !!(filtros.q || filtros.area || filtros.cargo || filtros.status);

  return (
    <>
      <Tiles>
        <Tile rotulo="Membros ativos" valor={ativos.length} />
        <Tile rotulo="Sem posição no organograma" valor={semPosicao} nota="ativos que precisam de lugar" />
        {completo ? <Tile rotulo="Com conta no CRM" valor={comConta} nota={`${base.membros.length - comConta} sem conta`} /> : null}
        {completo ? <Tile rotulo="Conta difere do organograma" valor={difere} nota="ajuste na ficha" /> : null}
      </Tiles>
      <Painel>
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_10rem_auto] lg:items-end" action={HREF_MEMBROS}>
          <input type="hidden" name="visao" value="lista" />
          <label className="grid gap-1.5 text-xs text-fg-mute">
            {completo ? "Buscar nome ou e-mail" : "Buscar pelo nome"}
            <input name="q" type="search" defaultValue={filtros.q ?? ""} className={CAMPO} />
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Área
            <select name="area" defaultValue={filtros.area ?? ""} className={CAMPO}>
              <option value="">Todas</option>
              {opcoesArea.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Cargo
            <select name="cargo" defaultValue={filtros.cargo ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {base.cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-fg-mute">
            Status
            <select name="status" defaultValue={filtros.status ?? ""} className={CAMPO}>
              <option value="">Todos</option>
              {STATUS_MEMBRO.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS_MEMBRO[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button className="h-8 rounded-lg border border-border-strong px-3 text-sm hover:bg-surface-hover">Filtrar</button>
            {filtrando ? (
              <Link href={`${HREF_MEMBROS}?visao=lista`} className="text-xs text-fg-mute underline hover:text-foreground">
                limpar
              </Link>
            ) : null}
          </div>
        </form>
      </Painel>
      <Painel titulo="Pessoas" contagem={lista.length}>
        <Tabela colunas={completo ? ["Pessoa", "Área · cargo", "No CRM", "Carga", "Status"] : ["Pessoa", "Área · cargo", "Status"]} vazio={lista.length ? undefined : "Nenhum membro com esses filtros."}>
          {lista.map((m) => {
            const ps = postosDe(base, m.id);
            const d = completo ? derivadoDe(base, m.id) : null;
            const c = completo && m.usuarioId ? carga.get(m.usuarioId) : null;
            return (
              <tr key={m.id} className="hover:bg-surface-hover">
                <td>
                  <Link href={`${HREF_MEMBROS}/${m.id}`} className="flex items-center gap-2.5 hover:underline">
                    <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
                    <span className="grid">
                      <span>{m.nome}</span>
                      {completo ? <span className="font-mono text-[11px] text-fg-faint">{m.email ?? "sem e-mail"}</span> : null}
                    </span>
                  </Link>
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {ps.length ? (
                      ps.map((p) => (
                        <Chip key={p.ocupacao.id}>
                          {areaDe(p.areaId)?.nome ?? "?"} · {cargoDe(p.cargoId)?.nome ?? p.nome}
                        </Chip>
                      ))
                    ) : (
                      <span className="text-fg-faint">sem posição</span>
                    )}
                  </span>
                </td>
                {completo ? (
                  <>
                    <td>
                      {d?.conflito ? (
                        <Chip tom="aviso">duas áreas</Chip>
                      ) : d?.area ? (
                        <Chip tom="coral">
                          {d.area}
                          {d.cargos.length ? ` · ${d.cargos.map((x) => ROTULO_CARGO[x]).join(", ")}` : ""}
                        </Chip>
                      ) : null}{" "}
                      {m.usuarioId ? <Chip tom="ok">conta</Chip> : <span className="text-xs text-fg-faint">sem conta</span>}
                    </td>
                    <td className="font-mono text-xs text-fg-mute">{c ? `${c.projetos} proj · ${c.tarefas} tarefas` : "—"}</td>
                  </>
                ) : null}
                <td>
                  <Chip tom={TOM_STATUS[m.status]}>{ROTULO_STATUS_MEMBRO[m.status]}</Chip>
                </td>
              </tr>
            );
          })}
        </Tabela>
      </Painel>
    </>
  );
}
