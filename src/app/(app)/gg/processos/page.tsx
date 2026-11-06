import { Chip, Painel } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { ROTULO_CATEGORIA } from "@/lib/gg/modelo";
import { ehEditorGG } from "@/lib/gg/organizacao";
import { carregarRaci } from "@/lib/gg/rotina";
import { CelulaRaci, NovoProcesso } from "./raci";

export const metadata = { title: "Papéis e processos · G&G" };

/** Matriz RACI: Responsável, Aprova (um por processo), Consultado, Informado — por cargo. */
export default async function ProcessosPage() {
  const ator = await exigirUsuario();
  const [{ processos, cargos }, editor] = await Promise.all([carregarRaci(), ehEditorGG(ator)]);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · processos" title="Papéis e processos" description="Quem é Responsável, quem Aprova, quem é Consultado e quem é Informado em cada processo." />
      {editor ? <p className="rounded-xl border border-primary/35 bg-primary-soft/30 px-4 py-3 text-sm text-fg-soft">Clique numa célula para trocar o papel. Cada processo tem um único A (aprovador); escolher outro A rebaixa o anterior para R.</p> : null}
      <Painel titulo="Matriz RACI" contagem={processos.length} acoes={editor ? <NovoProcesso /> : null}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="eyebrow px-4 py-2.5 text-left font-normal">Processo</th>
                {cargos.map((c) => (
                  <th key={c.id} className="px-2 py-2.5 text-center text-xs font-medium text-fg-soft">
                    {c.nome}
                    <span className="block font-mono text-[10px] font-normal text-fg-faint">{ROTULO_CATEGORIA[c.categoria]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processos.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2">
                    {p.nome} {Object.values(p.papeis).includes("A") ? null : <Chip tom="aviso">sem aprovador</Chip>}
                  </td>
                  {cargos.map((c) => (
                    <td key={c.id} className="px-2 py-1.5 text-center">
                      <CelulaRaci processoId={p.id} cargoId={c.id} papel={p.papeis[c.id] ?? null} editor={editor} rotulo={`${p.nome}, ${c.nome}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!processos.length ? <p className="px-4 py-6 text-sm text-fg-faint">Nenhum processo ainda.</p> : null}
        </div>
      </Painel>
      <p className="flex flex-wrap gap-3 text-xs text-fg-mute">
        <span><Chip tom="gg">R</Chip> executa</span>
        <span><Chip tom="coral">A</Chip> aprova (um por processo)</span>
        <span><Chip tom="aviso">C</Chip> é consultado</span>
        <span><Chip>I</Chip> é informado</span>
      </p>
    </div>
  );
}
