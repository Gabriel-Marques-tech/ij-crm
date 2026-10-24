import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DiasNaFase } from "@/components/kanban/aging";
import { Avatar } from "@/components/kanban/avatar";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarPipelines } from "@/lib/fases/fases";
import { diaEmFuso, diasNaFase, estadoProximaAcao, nivelAging } from "@/lib/oportunidades/aging";
import { ROTULO_ORIGEM, UFS } from "@/lib/oportunidades/campos";
import { formatarDataHora, formatarDinheiro, formatarDia } from "@/lib/oportunidades/formatar";
import { listarResponsaveis, nomesDeUsuarios, obterCard } from "@/lib/oportunidades/oportunidades";
import { CampoInline, RevisarSwitch } from "./campo-inline";
import { MoverFase } from "./mover-fase";
import { NotaForm } from "./nota-form";
import { Timeline } from "./timeline";

export const metadata = { title: "Card" };

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario();
  const { id } = await params;
  const card = await obterCard(id);
  if (!card) notFound();

  const idsUsuarios = new Set<string>([card.responsavelId]);
  for (const t of card.timeline) {
    const p = t.payload as Record<string, unknown> | null;
    if (p && p.campo === "responsavelId") {
      if (typeof p.antes === "string") idsUsuarios.add(p.antes);
      if (typeof p.depois === "string") idsUsuarios.add(p.depois);
    }
  }
  const [pipelines, responsaveis, nomes] = await Promise.all([
    listarPipelines({ incluirArquivadas: true }),
    listarResponsaveis(),
    nomesDeUsuarios(idsUsuarios),
  ]);
  const todasFases = pipelines.flatMap((p) => p.fases);
  const nomesFases = new Map(todasFases.map((f) => [f.id, f.nome]));
  const fasesDoQuadro = (pipelines.find((p) => p.id === card.pipelineId)?.fases ?? []).filter((f) => f.arquivadaEm === null || f.id === card.faseId);

  const agora = new Date();
  const dias = diasNaFase(card.faseDesde, agora);
  const nivel = nivelAging(dias, card.fase.limiteDiasAlerta);
  const acao = estadoProximaAcao(card.proximaAcaoEm, agora);
  const diaAcao = card.proximaAcaoEm ? diaEmFuso(card.proximaAcaoEm) : "";
  const orcamento = card.orcamentoPrevisto?.toFixed(2) ?? "";

  // Responsável atual pode estar inativo: continua na lista para não "sumir" do select.
  const opcoesResp = responsaveis.some((r) => r.id === card.responsavelId)
    ? responsaveis
    : [{ id: card.responsavelId, nome: `${card.responsavel.nome} (inativo)` }, ...responsaveis];

  return (
    <>
      <Link
        href={`/kanban?quadro=${card.pipeline.chave}`}
        className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {card.pipeline.nome}
      </Link>

      <header className="mb-6 rounded-xl border border-border bg-surface p-4">
        <p className="eyebrow mb-1">
          {card.pipeline.chave} · {card.fase.nome}
          {card.fase.arquivadaEm ? " (arquivada)" : ""}
        </p>
        <CampoInline cardId={card.id} campo="titulo" rotulo="Título" valor={card.titulo} className="[&_button]:text-xl [&_button]:font-semibold [&>label]:sr-only" />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-mute">
          <DiasNaFase dias={dias} nivel={nivel} />
          <span className="inline-flex items-center gap-2">
            <Avatar nome={card.responsavel.nome} /> {card.responsavel.nome}
          </span>
          {card.revisar ? (
            <span className="rounded-full border border-warn/60 px-1.5 font-mono text-[10px] leading-4 text-fg-soft uppercase">revisar</span>
          ) : null}
          {acao === "vencida" || acao === "hoje" ? (
            <span className="inline-flex items-center gap-1.5 text-fg-soft">
              <span aria-hidden className={`size-1.5 rounded-full ${acao === "vencida" ? "bg-danger" : "bg-warn"}`} />
              próxima ação {acao === "vencida" ? "vencida" : "hoje"}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-fg-faint">criado {formatarDataHora(card.criadoEm)}</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium">Dados</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoverFase
                cardId={card.id}
                titulo={card.titulo}
                faseAtualId={card.faseId}
                fases={fasesDoQuadro.map((f) => ({
                  id: f.id,
                  nome: f.arquivadaEm ? `${f.nome} (arquivada)` : f.nome,
                  cor: f.cor,
                  limiteDiasAlerta: f.limiteDiasAlerta,
                  isTerminal: f.isTerminal,
                  tipoTerminal: f.tipoTerminal,
                }))}
              />
              <CampoInline
                cardId={card.id}
                campo="responsavelId"
                rotulo="Responsável"
                tipo="select"
                valor={card.responsavelId}
                opcoes={opcoesResp.map((r) => ({ valor: r.id, rotulo: r.nome }))}
              />
              <CampoInline
                cardId={card.id}
                campo="origem"
                rotulo="Origem"
                tipo="select"
                valor={card.origem ?? ""}
                opcoes={[{ valor: "", rotulo: "—" }, ...Object.entries(ROTULO_ORIGEM).map(([valor, rotulo]) => ({ valor, rotulo }))]}
              />
              <CampoInline
                cardId={card.id}
                campo="orcamentoPrevisto"
                rotulo="Orçamento previsto"
                tipo="dinheiro"
                valor={orcamento ? orcamento.replace(".", ",") : ""}
                exibicao={orcamento ? formatarDinheiro(orcamento) : undefined}
              />
              <CampoInline cardId={card.id} campo="cidade" rotulo="Cidade" valor={card.cidade ?? ""} />
              <CampoInline
                cardId={card.id}
                campo="estado"
                rotulo="Estado"
                tipo="select"
                valor={card.estado ?? ""}
                opcoes={[{ valor: "", rotulo: "—" }, ...UFS.map((uf) => ({ valor: uf, rotulo: uf }))]}
              />
              <CampoInline cardId={card.id} campo="propostaUrl" rotulo="Proposta (link)" tipo="url" valor={card.propostaUrl ?? ""} className="sm:col-span-2" />
              <CampoInline cardId={card.id} campo="dor" rotulo="Dor" tipo="textarea" valor={card.dor ?? ""} className="sm:col-span-2" />
              <CampoInline cardId={card.id} campo="proximaAcao" rotulo="Próxima ação" valor={card.proximaAcao ?? ""} />
              <CampoInline
                cardId={card.id}
                campo="proximaAcaoEm"
                rotulo="Data da próxima ação"
                tipo="data"
                valor={diaAcao}
                exibicao={diaAcao ? formatarDia(diaAcao) : undefined}
              />
              <div className="sm:col-span-2">
                <RevisarSwitch cardId={card.id} valor={card.revisar} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">Nota</h2>
            <NotaForm cardId={card.id} />
          </section>
        </div>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-4 text-sm font-medium">Timeline</h2>
          <Timeline entradas={card.timeline} fases={nomesFases} nomes={nomes} />
        </section>
      </div>
    </>
  );
}
