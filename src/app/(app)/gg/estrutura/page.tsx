import { Chip, Painel, Tabela } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { exigirUsuario } from "@/lib/auth/atual";
import { descendentes, ROTULO_CATEGORIA, ROTULO_TIPO_AREA, vigente } from "@/lib/gg/modelo";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { NovaPosicao } from "./nova-posicao";

export const metadata = { title: "Áreas e cargos · G&G" };

const TOM_CATEGORIA = { DIRETORIA: "coral", LIDERANCA: "gg", MEMBRO: "neutro" } as const;

/** Catálogo: áreas e frentes, cargos (com categoria e efeito no CRM) e posições. */
export default async function EstruturaPage() {
  const ator = await exigirUsuario();
  const [base, editor] = await Promise.all([carregarBase(), ehEditorGG(ator)]);
  const ocupadas = (ids: Set<string>) => base.ocupacoes.filter((o) => vigente(o, base.hoje) && ids.has(base.posicoes.find((p) => p.id === o.posicaoId)?.areaId ?? "")).length;
  const topo = base.areas.filter((a) => !a.superiorId);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · estrutura" title="Áreas e cargos" description="Áreas, frentes e estruturas institucionais têm tipos diferentes. A posição junta cargo e área: é ela que entra no organograma." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {topo.map((a) => {
          const frentes = base.areas.filter((x) => x.superiorId === a.id);
          return (
            <article key={a.id} className="grid content-start gap-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 font-medium">{a.nome}</h2>
                <Chip>{ROTULO_TIPO_AREA[a.tipo]}</Chip>
              </div>
              <p className="text-xs text-fg-mute">{ocupadas(descendentes(base.areas, a.id))} ocupações atuais</p>
              <div className="flex flex-wrap gap-1.5">
                {a.ladoCrm ? <Chip tom="coral">no CRM: {ROTULO_AREA[a.ladoCrm]}</Chip> : null}
                {a.ehGG ? <Chip tom="gg">edita a área G&amp;G</Chip> : null}
              </div>
              {frentes.length ? (
                <ul className="grid gap-1 border-l border-border-strong pl-3 text-sm">
                  {frentes.map((f) => (
                    <li key={f.id} className="flex items-center gap-2">
                      <span className="flex-1">{f.nome}</span>
                      <Chip tom="gg">frente</Chip>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
      <Painel titulo="Cargos" contagem={base.cargos.length}>
        <Tabela colunas={["Cargo", "Categoria", "Posições", "Pessoas hoje", "Efeito no CRM"]}>
          {base.cargos.map((c) => {
            const ps = base.posicoes.filter((p) => p.cargoId === c.id);
            const pessoas = base.ocupacoes.filter((o) => vigente(o, base.hoje) && ps.some((p) => p.id === o.posicaoId)).length;
            return (
              <tr key={c.id}>
                <td>{c.nome}</td>
                <td>
                  <Chip tom={TOM_CATEGORIA[c.categoria]}>{ROTULO_CATEGORIA[c.categoria]}</Chip>
                </td>
                <td className="text-fg-mute">{ps.map((p) => p.nome).join(", ") || "—"}</td>
                <td className="font-mono tabular">{pessoas}</td>
                <td className="text-xs text-fg-mute">{c.categoria === "DIRETORIA" ? "papel GESTOR" : c.ehGp ? "GP da área (Projetos)" : "papel da área"}</td>
              </tr>
            );
          })}
        </Tabela>
      </Painel>
      <Painel titulo="Posições" contagem={base.posicoes.length} acoes={editor ? <NovaPosicao areas={base.areas.map((a) => ({ id: a.id, nome: a.nome }))} cargos={base.cargos.map((c) => ({ id: c.id, nome: c.nome }))} posicoes={base.posicoes.map((p) => ({ id: p.id, nome: p.nome }))} /> : null}>
        <Tabela colunas={["Posição", "Área", "Cargo", "Responde a"]}>
          {base.posicoes.map((p) => (
            <tr key={p.id}>
              <td>{p.nome}</td>
              <td className="text-fg-mute">{base.areas.find((a) => a.id === p.areaId)?.nome}</td>
              <td className="text-fg-mute">{base.cargos.find((c) => c.id === p.cargoId)?.nome}</td>
              <td className="text-fg-mute">{base.posicoes.find((x) => x.id === p.liderancaId)?.nome ?? "—"}</td>
            </tr>
          ))}
        </Tabela>
      </Painel>
    </div>
  );
}
