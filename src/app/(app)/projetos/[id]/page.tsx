import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DiasNaFase } from "@/components/kanban/aging";
import { Avatar } from "@/components/kanban/avatar";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { listarAnexos } from "@/lib/anexos/anexos";
import { pessoaDaCaneta } from "@/lib/propostas/propostas";
import { listarGpsDeProjetos } from "@/lib/avisos/handoff";
import { cronogramaSemProposta, obterCronograma } from "@/lib/projetos/execucao";
import { podeOperarExecucao } from "@/lib/projetos/execucao-regras";
import { listarCandidatosGp, obterHandoff } from "@/lib/projetos/handoff";
import { podeDesignarGp, podeEscreverResumo } from "@/lib/projetos/handoff-regras";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarPipelines } from "@/lib/fases/fases";
import { diaEmFuso, diasNaFase, estadoProximaAcao, nivelAging } from "@/lib/projetos/aging";
import { ROTULO_ORIGEM, UFS } from "@/lib/projetos/campos";
import { formatarDataHora, formatarDinheiro, formatarDia } from "@/lib/projetos/formatar";
import { idDoCardQueAbsorveu, listarResponsaveis, nomesDeUsuarios, obterCard } from "@/lib/projetos/projetos";
import { AnexosDoProjeto } from "./anexos";
import { ExecucaoDoProjeto } from "./execucao";
import { HandoffDoProjeto } from "./handoff";
import { CampoInline, RevisarSwitch } from "./campo-inline";
import { DescricaoCard } from "./descricao-card";
import { MoverFase } from "./mover-fase";
import { alemDoContrato } from "@/lib/projetos/trava-contrato";
import { ResumoAvaliacaoContato } from "@/components/avaliacao/nota-contato";
import { resumoAvaliacao } from "@/lib/projetos/avaliacao";
import { NotaForm } from "./nota-form";
import { ResultadoTerminal } from "./resultado-terminal";
import { Timeline, type CardRelacionado } from "./timeline";
import { Vinculos } from "./vinculos";
import { ExcluirCard } from "@/components/lixeira/excluir-card";
import { podeVerTarefas } from "@/lib/auth/areas";
import { podeVerTarefasNoProjeto, resumoTarefas } from "@/lib/tarefas/tarefas";
import { AbasProjeto } from "./abas-projeto";
import { podeEscrever, temPapelMinimo } from "@/lib/auth/papeis";
import { podeEditarCard, podeEditarChecklistHandoff, podeTrocarResponsavel } from "@/lib/auth/visibilidade";
import { mascararMotivoInviavel, podeVerPropostaDoProjeto, timelineSemProposta } from "@/lib/propostas/acesso";
import { listarPrazosDoCard } from "@/lib/prazos/prazos";
import { PrazosProvider } from "../../_calendario/editor-prazo";
import { PrazosDoCard } from "./prazos-card";
import { StatusPropostaBadge } from "@/components/propostas/status-proposta";

export const metadata = { title: "Card" };

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const ator = await exigirUsuario();
  // VISUALIZADOR lê o card, sem controles de escrita (as actions recusam no servidor de qualquer jeito).
  const leitura = !podeEscrever(ator.papel);
  const { id } = await params;
  const card = await obterCard(id);
  if (!card) {
    // Link antigo de um card de projetos absorvido pelo ciclo único (GAB-81) → o card que o absorveu.
    const destino = await idDoCardQueAbsorveu(id);
    if (destino) redirect(`/projetos/${destino}`);
    notFound();
  }

  // GAB-98: mover e editar dados são da área dona e do responsável; quem é de fora comenta, cria prazo e anexa.
  const soLeituraDados = !podeEditarCard(ator, { responsavelId: card.responsavelId, quadro: card.pipeline.chave });
  // A proposta só para quem a vê: seção, link e os eventos dela na Timeline.
  const veProposta = await podeVerPropostaDoProjeto(ator, card.id);
  // Kanban interno: só time de projetos e só card no quadro de Projetos (spec do kanban interno §4/§5).
  // Abas do projeto: o time de projetos vê a equipe; as tarefas, só quem está escalado (ou a diretoria).
  const comAbas = podeVerTarefas(ator) && card.pipeline.chave === "projetos";
  const comTarefas = comAbas && (await podeVerTarefasNoProjeto(card.id, ator)) === true;
  const tarefas = comTarefas ? await resumoTarefas(card.id, ator.id, diaEmFuso(new Date())) : null;
  const timeline = veProposta ? card.timeline : timelineSemProposta(card.timeline);
  const motivoPerda = veProposta ? card.motivoPerda : mascararMotivoInviavel(card.motivoPerda);

  const idsUsuarios = new Set<string>([card.responsavelId]);
  for (const t of timeline) {
    const p = t.payload as Record<string, unknown> | null;
    if (p && p.campo === "responsavelId") {
      if (typeof p.antes === "string") idsUsuarios.add(p.antes);
      if (typeof p.depois === "string") idsUsuarios.add(p.depois);
    }
  }
  const agora = new Date();
  const hoje = diaEmFuso(agora);
  const [pipelines, responsaveis, nomes, prazos, anexos, handoff, pessoa, cronogramaCompleto] = await Promise.all([
    listarPipelines({ incluirArquivadas: true }),
    listarResponsaveis(),
    nomesDeUsuarios(idsUsuarios),
    listarPrazosDoCard(card.id, ator, hoje),
    listarAnexos(card.id),
    obterHandoff(card.id),
    pessoaDaCaneta(ator.id),
    obterCronograma(card.id, agora),
  ]);
  // GAB-93: fora da coluna Handoff o bloco é só registro, e some em card isento sem nada preenchido.
  const verHandoff = handoff && (handoff.emHandoff || !handoff.isento || handoff.gp || handoff.resumoEm);
  const designa = !!pessoa && pessoa.ativo && podeDesignarGp(pessoa);
  // GAB-95: valor, versão e o que dá para copiar são da proposta. Título e datas ficam abertos.
  const cronograma = cronogramaCompleto && !veProposta ? cronogramaSemProposta(cronogramaCompleto) : cronogramaCompleto;
  const candidatosGp = (handoff?.emHandoff || cronograma?.emExecucao) && designa ? await listarCandidatosGp() : [];
  const semGpDeProjetos = !!handoff?.emHandoff && !handoff.gpValido && !designa && (await listarGpsDeProjetos()).length === 0;
  const todasFases = pipelines.flatMap((p) => p.fases);
  const nomesFases = new Map(todasFases.map((f) => [f.id, f.nome]));
  const fasesDoQuadro = (pipelines.find((p) => p.id === card.pipelineId)?.fases ?? []).filter((f) => f.arquivadaEm === null || f.id === card.faseId);
  // GAB-99: "Contrato assinado" aparece em Montando contrato ou depois (a regra mesmo é do servidor).
  const faseAtual = fasesDoQuadro.find((f) => f.id === card.faseId);
  const montandoContrato = fasesDoQuadro.find((f) => f.marco === "MONTANDO_CONTRATO");
  const ganhoParaAssinar =
    faseAtual && montandoContrato && !faseAtual.isTerminal && alemDoContrato(faseAtual, montandoContrato) ? (fasesDoQuadro.find((f) => f.marco === "GANHO")?.id ?? null) : null;

  // Ciclo único (GAB-81): a Timeline herdada da v1 cita a venda/o card de projetos que
  // agora são este mesmo card (`mesmoCard`). Pares NÃO unidos seguem como dois cards: o
  // irmão vivo e não absorvido vira link; o resto aparece como "removido".
  const relacionados = new Map<string, CardRelacionado>(
    [card.vendaOrigem, card.cardProjetos].flatMap((c) =>
      c && !c.deletadoEm && !c.absorvidoPorId ? [[c.id, { titulo: c.titulo, quadro: c.pipeline.chave }] as const] : [],
    ),
  );
  const mesmoCard = new Set([card.id, ...card.absorvidos.map((a) => a.id)]);
  // GAB-85: "os leads gostaram do contato?" — notas do vendedor e sentimento lido pela LLM.
  const avaliacao = resumoAvaliacao(card.timeline);

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
      {/* Navegação acende Vendas/Projetos pelo quadro do card (sem depender de ?quadro=). */}
      <MarcarQuadroAtivo quadro={card.pipeline.chave} />
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
        <CampoInline somenteLeitura={soLeituraDados} cardId={card.id} campo="titulo" rotulo="Título" valor={card.titulo} className="[&_button]:text-xl [&_button]:font-semibold [&>p]:text-xl [&>p]:font-semibold [&>label]:sr-only" />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-mute">
          <DiasNaFase dias={dias} nivel={nivel} />
          <span className="inline-flex items-center gap-2">
            <Avatar nome={card.responsavel.nome} usuarioId={card.responsavel.id} fotoEm={card.responsavel.foto?.atualizadoEm.getTime() ?? null} /> {card.responsavel.nome}
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
          {soLeituraDados ? null : <ExcluirCard cardId={card.id} titulo={card.titulo} quadro={card.pipeline.chave} />}
        </div>
      </header>

      {comAbas ? <AbasProjeto projetoId={card.id} ativa="geral" tarefasAbertas={tarefas?.abertas ?? null} /> : null}

      <ResultadoTerminal card={{ ...card, motivoPerda }} />

      {verHandoff ? (
        <HandoffDoProjeto
          cardId={card.id}
          handoff={handoff}
          somenteLeitura={leitura}
          podeEditar={podeEditarChecklistHandoff(ator, { responsavelId: card.responsavelId, quadro: card.pipeline.chave })}
          podeMover={!soLeituraDados}
          veProposta={veProposta}
          podeDesignar={designa}
          podeResumo={!!pessoa && pessoa.ativo && podeEscreverResumo(pessoa)}
          candidatosGp={candidatosGp}
          semGpDeProjetos={semGpDeProjetos}
          pdfs={anexos.filter((a) => a.tipo === "PDF").map((a) => ({ id: a.id, nome: a.nome }))}
        />
      ) : null}

      {/* GAB-95: em Execução, ou o registro de quem já passou por ela. Todos leem; quem opera é decidido no servidor. */}
      {cronograma && (cronograma.emExecucao || cronograma.entregas.length > 0 || cronograma.canceladas.length > 0 || cronograma.checkins.length > 0) ? (
        <ExecucaoDoProjeto
          cardId={card.id}
          cronograma={cronograma}
          hoje={hoje}
          podeOperar={cronograma.emExecucao && !!pessoa && podeOperarExecucao({ ...pessoa, id: ator.id }, cronograma.gp.id)}
          podeDesignar={designa}
          candidatosGp={candidatosGp}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium">Dados</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoverFase
                somenteLeitura={soLeituraDados}
                veProposta={veProposta}
                responsavelNome={card.responsavel.nome}
                ganhoId={ganhoParaAssinar}
                cardId={card.id}
                titulo={card.titulo}
                faseAtualId={card.faseId}
                pipelineChave={card.pipeline.chave}
                fechamento={{ valorFechado: card.valorFechado?.toFixed(2) ?? null, motivoPerda }}
                fases={fasesDoQuadro.map((f) => ({
                  id: f.id,
                  chave: f.chave,
                  nome: f.arquivadaEm ? `${f.nome} (arquivada)` : f.nome,
                  cor: f.cor,
                  limiteDiasAlerta: f.limiteDiasAlerta,
                  isTerminal: f.isTerminal,
                  tipoTerminal: f.tipoTerminal,
                }))}
              />
              <CampoInline
                somenteLeitura={!podeTrocarResponsavel(ator, { responsavelId: card.responsavelId, quadro: card.pipeline.chave })}
                cardId={card.id}
                campo="responsavelId"
                rotulo="Responsável"
                tipo="select"
                valor={card.responsavelId}
                opcoes={opcoesResp.map((r) => ({ valor: r.id, rotulo: r.nome }))}
              />
              <CampoInline
                somenteLeitura={soLeituraDados}
                cardId={card.id}
                campo="origem"
                rotulo="Origem"
                tipo="select"
                valor={card.origem ?? ""}
                opcoes={[{ valor: "", rotulo: "—" }, ...Object.entries(ROTULO_ORIGEM).map(([valor, rotulo]) => ({ valor, rotulo }))]}
              />
              <CampoInline
                somenteLeitura={soLeituraDados}
                cardId={card.id}
                campo="orcamentoPrevisto"
                rotulo="Orçamento previsto"
                tipo="dinheiro"
                valor={orcamento ? orcamento.replace(".", ",") : ""}
                exibicao={orcamento ? formatarDinheiro(orcamento) : undefined}
              />
              <CampoInline somenteLeitura={soLeituraDados} cardId={card.id} campo="cidade" rotulo="Cidade" valor={card.cidade ?? ""} />
              <CampoInline
                somenteLeitura={soLeituraDados}
                cardId={card.id}
                campo="estado"
                rotulo="Estado"
                tipo="select"
                valor={card.estado ?? ""}
                opcoes={[{ valor: "", rotulo: "—" }, ...UFS.map((uf) => ({ valor: uf, rotulo: uf }))]}
              />
              {veProposta ? <CampoInline somenteLeitura={soLeituraDados} cardId={card.id} campo="propostaUrl" rotulo="Proposta (link)" tipo="url" valor={card.propostaUrl ?? ""} className="sm:col-span-2" /> : null}
              <CampoInline somenteLeitura={soLeituraDados} cardId={card.id} campo="dor" rotulo="Dor" tipo="textarea" valor={card.dor ?? ""} className="sm:col-span-2" />
              <CampoInline somenteLeitura={soLeituraDados} cardId={card.id} campo="proximaAcao" rotulo="Próxima ação" valor={card.proximaAcao ?? ""} />
              <CampoInline
                somenteLeitura={soLeituraDados}
                cardId={card.id}
                campo="proximaAcaoEm"
                rotulo="Data da próxima ação"
                tipo="data"
                valor={diaAcao}
                exibicao={diaAcao ? formatarDia(diaAcao) : undefined}
              />
              <div className="sm:col-span-2">
                <RevisarSwitch cardId={card.id} valor={card.revisar} somenteLeitura={soLeituraDados} />
              </div>
            </div>
          </section>

          {veProposta ? <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Proposta</h2>
              {card.proposta ? <StatusPropostaBadge status={card.proposta.status} /> : null}
              <span className="flex-1" />
              <Link href={`/projetos/${card.id}/proposta`} className="text-sm text-fg-soft underline decoration-fg-faint underline-offset-2 hover:text-foreground">
                {card.proposta ? "Abrir proposta" : "Ver / criar proposta"}
              </Link>
            </div>
            <p className="mt-1 text-xs text-fg-mute">
              {card.proposta
                ? card.proposta._count.versoes > 0
                  ? `${card.proposta._count.versoes} ${card.proposta._count.versoes === 1 ? "versão salva" : "versões salvas"}.`
                  : "Só rascunho, nenhuma versão salva ainda."
                : "Ainda sem proposta (uma por projeto)."}
            </p>
          </section> : null}

          {/* Kanban interno (tarefas do time): resumo aqui; o quadro é a aba Tarefas. */}
          {tarefas ? (
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">Tarefas do time</h2>
                <span className="flex-1" />
                <Link href={`/projetos/${card.id}/tarefas`} className="text-sm text-fg-soft underline decoration-fg-faint underline-offset-2 hover:text-foreground">
                  Abrir quadro
                </Link>
              </div>
              {tarefas.abertas ? (
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ["abertas", tarefas.abertas, ""],
                    ["com você", tarefas.minhas, ""],
                    ["atrasadas", tarefas.atrasadas, tarefas.atrasadas ? "text-danger" : ""],
                  ].map(([rotulo, n, cor]) => (
                    <div key={rotulo as string} className="rounded-lg border border-border px-3 py-2">
                      <dd className={`font-mono text-lg tabular ${cor}`}>{n}</dd>
                      <dt className="eyebrow">{rotulo}</dt>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-xs text-fg-mute">Nenhuma tarefa aberta. Só o time de projetos vê este quadro.</p>
              )}
            </section>
          ) : null}

          <DescricaoCard cardId={card.id} valor={card.descricao} somenteLeitura={soLeituraDados} />

          <AnexosDoProjeto cardId={card.id} anexos={anexos} somenteLeitura={leitura} excluiDeTodos={!soLeituraDados} euId={ator.id} />

          <PrazosProvider
            eu={{ id: ator.id, nome: ator.nome }}
            gestor={temPapelMinimo(ator.papel, "GESTOR")}
            responsaveis={responsaveis}
            // Gestor: sugere o responsável do card; vendedor: sempre ele mesmo.
            responsavelPadrao={card.responsavelId}
          >
            <PrazosDoCard cardId={card.id} prazos={prazos} hoje={hoje} />
          </PrazosProvider>

          <Vinculos cardId={card.id} somenteLeitura={soLeituraDados} />

          {leitura ? null : (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-medium">Nota</h2>
              <NotaForm cardId={card.id} />
            </section>
          )}
        </div>

        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Timeline</h2>
            {avaliacao ? <ResumoAvaliacaoContato resumo={avaliacao} /> : null}
          </div>
          <Timeline entradas={timeline} fases={nomesFases} nomes={nomes} relacionados={relacionados} mesmoCard={mesmoCard} />
        </section>
      </div>
    </>
  );
}
