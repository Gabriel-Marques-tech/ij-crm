import Link from "next/link";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarPipelines } from "@/lib/fases/fases";
import { listarQuadro } from "@/lib/oportunidades/oportunidades";
import { QuadroKanban } from "./quadro-kanban";
import { paraCliente } from "./tipos";

export const metadata = { title: "Kanban" };

/**
 * "Agora" do request. Server component renderiza uma vez por request, então
 * ler o relógio aqui é seguro; o cliente recebe o mesmo instante e calcula os
 * dias na fase sem divergir do HTML do servidor (sem hydration mismatch).
 */
function agoraDoRequest(): number {
  return Date.now();
}

export default async function KanbanPage({ searchParams }: { searchParams: Promise<{ quadro?: string }> }) {
  await exigirUsuario();
  const { quadro: chave = "vendas" } = await searchParams;
  const [pipelines, quadro] = await Promise.all([listarPipelines(), listarQuadro(chave)]);

  return (
    <>
      <PageHeader
        eyebrow={`kanban · ${quadro?.pipeline.chave ?? chave}`}
        title={quadro?.pipeline.nome ?? "Kanban"}
        description="Arraste os cards entre as fases (ou foque um card e use espaço + setas). Clique no título para abrir o detalhe."
      />
      {pipelines.length > 1 ? (
        <nav aria-label="Quadros" className="-mt-4 mb-6 flex gap-1">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/kanban?quadro=${p.chave}`}
              aria-current={p.chave === chave ? "page" : undefined}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                p.chave === chave ? "border-border-strong bg-surface text-foreground" : "border-transparent text-fg-mute hover:bg-surface-hover",
              )}
            >
              {p.nome}
            </Link>
          ))}
        </nav>
      ) : null}
      {quadro ? (
        // `key` reinicia o estado otimista ao trocar de quadro.
        <QuadroKanban key={quadro.pipeline.id} pipelineId={quadro.pipeline.id} agoraMs={agoraDoRequest()} {...paraCliente(quadro)} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-faint">
          Quadro não encontrado. Rode <code className="font-mono">pnpm db:seed</code>.
        </p>
      )}
    </>
  );
}
