import Link from "next/link";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { podeEscrever } from "@/lib/auth/papeis";
import { listarPipelines } from "@/lib/fases/fases";
import { listarQuadro, listarResponsaveis } from "@/lib/oportunidades/oportunidades";
import { visualizacaoKanban } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";
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
  const usuario = await exigirUsuario();
  const leitura = !podeEscrever(usuario.papel);
  const { quadro: chave = "vendas" } = await searchParams;
  const [pipelines, quadro, responsaveis, preferencias] = await Promise.all([
    listarPipelines(),
    listarQuadro(chave),
    listarResponsaveis(),
    obterPreferencias(usuario.id),
  ]);

  return (
    // Quadro ocupa a tela até embaixo: 100dvh menos topbar (3.5rem), padding
    // vertical do <main> (3rem / md 4rem) e barra inferior do mobile (4rem).
    // As colunas esticam nessa altura e cada lista rola sozinha.
    <div className="flex h-[calc(100dvh-10.5rem)] min-h-[28rem] flex-col md:h-[calc(100dvh-7.5rem)]">
      <PageHeader
        eyebrow={`kanban · ${quadro?.pipeline.chave ?? chave}`}
        title={quadro?.pipeline.nome ?? "Kanban"}
        description={
          leitura
            ? "Acesso de visualização: clique no título para abrir o detalhe."
            : "Arraste os cards entre as fases (ou foque um card e use espaço + setas). Clique no título para abrir o detalhe."
        }
      />
      {pipelines.length > 1 ? (
        <nav aria-label="Quadros" className="-mt-4 mb-4 flex shrink-0 gap-1">
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
        <QuadroKanban
          key={quadro.pipeline.id}
          pipelineId={quadro.pipeline.id}
          agoraMs={agoraDoRequest()}
          responsaveis={responsaveis}
          meuId={usuario.id}
          somenteLeitura={leitura}
          pipelineChave={quadro.pipeline.chave}
          visualizacao={visualizacaoKanban(preferencias, quadro.pipeline.chave, quadro.fases.map((f) => f.chave))}
          {...paraCliente(quadro)}
        />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-faint">
          Quadro não encontrado. Rode <code className="font-mono">pnpm db:seed</code>.
        </p>
      )}
    </div>
  );
}
