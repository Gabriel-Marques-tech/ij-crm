import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { listarPipelinesParaGestao } from "@/lib/fases/fases";
import { QuadroFases } from "./quadro-fases";

export const metadata = { title: "Fases" };

export default async function FasesPage() {
  await exigirPapel("GESTOR");
  const pipelines = await listarPipelinesParaGestao();
  return (
    <>
      <PageHeader
        eyebrow="gestão · fases"
        title="Fases"
        description="Fases de cada quadro: ordem, cor, limite de dias para alerta e quais são terminais (ganho/perdido). Mudanças valem na hora."
      />
      <div className="space-y-6">
        {pipelines.map((p) => (
          <QuadroFases key={p.id} pipeline={p} />
        ))}
        {pipelines.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-faint">
            Nenhum quadro ainda. Rode <code className="font-mono">pnpm db:seed</code>.
          </p>
        ) : null}
      </div>
    </>
  );
}
