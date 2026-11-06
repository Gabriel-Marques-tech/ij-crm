"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronsLeftRight, Plus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { EstadoVazio } from "@/components/estado-vazio";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executarAcao, falhaDe, FALHA_CONEXAO, type FalhaUI } from "@/lib/erros/cliente";
import { aplicarExibicao, ordenador, type Exibicao } from "@/lib/tarefas/exibicao";
import { FILTROS_VAZIOS, escreverFiltros, filtrarTarefas, lerFiltros, type Filtros } from "@/lib/tarefas/filtros";
import { PRIORIDADES, ROTULO_PRIORIDADE, TITULO_MAX, recebeTarefa, rotuloResponsavel, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";
import { COLUNAS, ROTULO_STATUS, SEM_ETIQUETA, SEM_RESPONSAVEL, agrupar, posicaoAoSoltar, type Linha } from "@/lib/tarefas/quadro";
import { colisaoQuadro } from "../../../kanban/colisao";
import { colunasAbertas, proximoAlvo } from "../../../kanban/colunas";
import { criarTarefaAction, editarTarefaAction, moverTarefaAction, salvarExibicaoTarefasAction } from "./actions";
import { BarraTarefas } from "./barra-tarefas";
import { CartaoTarefa, IconePrioridade, IconeStatus, corEtiqueta } from "./cartao-tarefa";
import { DetalheTarefa, type PatchLocal } from "./detalhe-tarefa";
import { ListaTarefas, idColuna } from "./lista-tarefas";
import { MenuOpcoes } from "./menu";

type Props = {
  projetoId: string;
  tarefas: TarefaLista[];
  pessoas: PessoaTarefa[];
  etiquetas: string[];
  exibicaoInicial: Exibicao;
  /** `YYYY-MM-DD` de hoje no fuso de negócio e o instante (vêm do servidor: sem diferença de hidratação). */
  hoje: string;
  agoraMs: number;
};

type Pre = { status: StatusTarefa; responsavelId: string | null; prioridade?: PrioridadeTarefa; etiquetas?: string[] };
type Atalho = { id: string; campo: "status" | "prio" | "resp"; ancora: HTMLElement | null } | null;
type MenuAberto = { tipo: "filtro" | "exibicao"; ancora: HTMLElement | null } | null;

const colunaDe = (id: string | number | undefined): string | null => {
  const s = String(id ?? "");
  return s.startsWith("col:") ? s.slice(4) : null;
};
const ATRASO_SALVAR_EXIBICAO_MS = 600;
/** Backlog e Cancelada começam recolhidas (spec §3), como as fases terminais no Kanban. */
const RECOLHIDA_POR_PADRAO = new Set<string>(COLUNAS.filter((c) => c.recolhida).map((c) => c.status));

/**
 * Tarefas do projeto: quadro (uma coluna por valor do agrupamento: status por
 * padrão, ou prioridade/responsável/etiqueta) ou lista, com filtros na URL e
 * exibição por pessoa. Colunas vazias viram faixa estreita, como no Kanban.
 * Otimista: o estado parte do servidor e é re-sincronizado quando chegam
 * props novas (revalidate após cada action; e ao voltar à aba).
 */
export function QuadroTarefas({ projetoId, tarefas: doServidor, pessoas, etiquetas: etiquetasServidor, exibicaoInicial, hoje, agoraMs }: Props) {
  const [base, setBase] = useState(doServidor);
  const [tarefas, setTarefas] = useState(doServidor);
  if (base !== doServidor) {
    setBase(doServidor);
    setTarefas(doServidor);
  }
  const [exibicao, setExibicao] = useState(exibicaoInicial);
  const [ativa, setAtiva] = useState<TarefaLista | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [abertasManual, setAbertasManual] = useState<Set<string>>(new Set());
  // Recolhidas à mão (qualquer coluna, mesmo com tarefas): só a faixa, até clicar de novo ou soltar um card nela.
  const [fechadasManual, setFechadasManual] = useState<Set<string>>(new Set());
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuAberto>(null);
  const [atalho, setAtalho] = useState<Atalho>(null);
  const [criarEm, setCriarEm] = useState<{ coluna: string; pre: Pre } | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const refFiltro = useRef<HTMLButtonElement>(null);
  const refExibicao = useRef<HTMLButtonElement>(null);
  const refQuadro = useRef<HTMLDivElement>(null);

  // Sem tempo real: atualiza ao voltar para a aba (spec §6).
  useEffect(() => {
    const aoVoltar = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [router]);

  /** Âncora do menu aberto por atalho (S/P/A): o cartão ou linha da tarefa, senão o botão Filtro. Lido num handler, nunca no render. */
  const abrirAtalho = (id: string, campo: "status" | "prio" | "resp") =>
    setAtalho({ id, campo, ancora: (refQuadro.current?.querySelector(`[data-id="${globalThis.CSS.escape(id)}"]`) as HTMLElement | null) ?? refFiltro.current });

  // Filtros moram na URL (link para um colega). `replaceState` não refaz o request.
  const searchParams = useSearchParams();
  const filtros = useMemo(() => lerFiltros(searchParams), [searchParams]);
  const mudarFiltros = useCallback((f: Filtros) => {
    const qs = escreverFiltros(f, new URLSearchParams(window.location.search)).toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  // Exibição: otimista, salva no servidor com atraso (vários cliques = um request).
  const salvarPendente = useRef<ReturnType<typeof setTimeout> | null>(null);
  function mudarExibicao(e: Exibicao) {
    setExibicao(e);
    if (salvarPendente.current) clearTimeout(salvarPendente.current);
    salvarPendente.current = setTimeout(() => void executarAcao(() => salvarExibicaoTarefasAction(e), "salvar a exibição").then((f) => f && setErro(f)), ATRASO_SALVAR_EXIBICAO_MS);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const porId = useMemo(() => new Map(tarefas.map((t) => [t.id, t])), [tarefas]);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const etiquetas = useMemo(() => [...new Set([...etiquetasServidor, ...tarefas.flatMap((t) => t.etiquetas)])].sort((a, b) => a.localeCompare(b, "pt-BR")), [etiquetasServidor, tarefas]);
  const visiveis = useMemo(() => filtrarTarefas(aplicarExibicao(tarefas, exibicao, agoraMs), filtros, hoje), [tarefas, exibicao, filtros, agoraMs, hoje]);
  const ord = useMemo(() => ordenador(exibicao, (id) => pessoaPorId.get(id)?.nome ?? id), [exibicao, pessoaPorId]);
  const agruparPor = exibicao.agrupar === "nenhum" ? "status" : exibicao.agrupar;
  const grupos = useMemo(() => agrupar(visiveis, pessoas, agruparPor, ROTULO_STATUS, ROTULO_PRIORIDADE).map((l) => ({ ...l, tarefas: [...l.tarefas].sort(ord) })), [visiveis, pessoas, agruparPor, ord]);
  const aberta = abertaId ? (porId.get(abertaId) ?? null) : null;
  const subtarefasDe = useCallback(
    (id: string) => {
      const f = tarefas.filter((t) => t.paiId === id);
      return f.length ? { feitas: f.filter((t) => t.status === "FEITA" || t.status === "CANCELADA").length, total: f.length } : null;
    },
    [tarefas],
  );

  // Colunas abertas: regra do Kanban (vazia ou Backlog/Cancelada → faixa, salvo aberta à mão, alvo do arrasto ou preferência).
  const arrastando = ativa !== null;
  const abertas = colunasAbertas({
    fases: grupos.map((g) => ({ id: g.chave, isTerminal: agruparPor === "status" && RECOLHIDA_POR_PADRAO.has(g.chave) && !exibicao.recolhidos })),
    contagem: new Map(grupos.map((g) => [g.chave, g.tarefas.length])),
    abertasManual,
    alvoArrasto: arrastando ? alvo : null,
    mostrarVazias: exibicao.vazios,
  });
  for (const chave of fechadasManual) if (!(arrastando && alvo === chave)) abertas.delete(chave);

  function aplicar(id: string, patch: PatchLocal) {
    setTarefas((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  /** Edição direta (lista, atalhos): otimista + action. */
  function editar(id: string, patch: PatchLocal) {
    const snapshot = tarefas;
    setErro(null);
    aplicar(id, patch);
    startTransition(async () => {
      const falha = await executarAcao(() => editarTarefaAction(projetoId, id, patch), "salvar a tarefa");
      if (falha) {
        setTarefas(snapshot);
        setErro(falha);
        router.refresh();
      }
    });
  }

  /** O que uma coluna do agrupamento impõe à tarefa solta nela. */
  function patchDaColuna(chave: string): PatchLocal {
    if (agruparPor === "status") return { status: chave as StatusTarefa };
    if (agruparPor === "resp") return { responsavelId: chave === SEM_RESPONSAVEL ? null : chave };
    if (agruparPor === "prio") return { prioridade: chave as PrioridadeTarefa };
    return {};
  }

  function mover(id: string, coluna: string, antesDeId: string | null) {
    const t = porId.get(id);
    if (!t) return;
    const patch = patchDaColuna(coluna);
    const naColuna = grupos.find((g) => g.chave === coluna)?.tarefas.filter((x) => x.id !== id) ?? [];
    const posicao = posicaoAoSoltar(naColuna, antesDeId, { manual: exibicao.ordenar === "posicao" && !exibicao.ordemDesc, mesmaColuna: colunaDoAlvo(id) === coluna });
    if (posicao === null) return;
    const status = patch.status ?? t.status;
    const mudaResp = patch.responsavelId !== undefined && patch.responsavelId !== t.responsavelId;
    const mudaPrio = patch.prioridade !== undefined && patch.prioridade !== t.prioridade;
    const snapshot = tarefas;
    setErro(null);
    setTarefas((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch, status, posicao } : x)));
    startTransition(async () => {
      const falha = await executarAcao(() => moverTarefaAction(projetoId, id, { status, posicao, ...(mudaResp ? { responsavelId: patch.responsavelId ?? null } : {}) }), "mover a tarefa");
      const falha2 = !falha && mudaPrio ? await executarAcao(() => editarTarefaAction(projetoId, id, { prioridade: patch.prioridade! }), "mudar a prioridade") : null;
      if (falha || falha2) {
        setTarefas(snapshot);
        setErro(falha ?? falha2);
        router.refresh();
      }
    });
  }

  const colunaDoAlvo = (overId: string | number | undefined): string | null => {
    const c = colunaDe(overId);
    if (c) return c;
    const t = porId.get(String(overId ?? ""));
    return t ? (grupos.find((g) => g.tarefas.some((x) => x.id === t.id))?.chave ?? null) : null;
  };
  function onDragStart(e: DragStartEvent) {
    setAtiva(porId.get(String(e.active.id)) ?? null);
    setAlvo(null);
  }
  function onDragOver(e: DragOverEvent) {
    setAlvo((atual) => proximoAlvo(atual, colunaDoAlvo(e.over?.id)));
  }
  function fimArrasto() {
    setAtiva(null);
    setAlvo(null);
  }
  function onDragEnd(e: DragEndEvent) {
    fimArrasto();
    const over = e.over?.id;
    if (over === undefined) return;
    const col = colunaDe(over);
    if (col) return mover(String(e.active.id), col, null);
    const alvoCard = porId.get(String(over));
    if (alvoCard && alvoCard.id !== e.active.id) {
      const col2 = colunaDoAlvo(alvoCard.id);
      if (col2) mover(String(e.active.id), col2, alvoCard.id);
    }
  }

  /** Clique na faixa abre; clique em "recolher" fecha. Toda coluna é encolhível, com ou sem tarefas. */
  const abrirColuna = (chave: string) => {
    setFechadasManual((f) => {
      const n = new Set(f);
      n.delete(chave);
      return n;
    });
    setAbertasManual((a) => new Set(a).add(chave));
  };
  const recolherColuna = (chave: string) => {
    setAbertasManual((a) => {
      const n = new Set(a);
      n.delete(chave);
      return n;
    });
    setFechadasManual((f) => new Set(f).add(chave));
  };
  const alternarGrupo = (chave: string) =>
    setFechados((f) => {
      const n = new Set(f);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  /** Pré-preenchimento ao criar numa coluna/grupo (status, responsável, prioridade ou etiqueta do lugar). */
  function preDe(l: Linha<TarefaLista>): Pre {
    const pre: Pre = { status: "A_FAZER", responsavelId: null };
    if (agruparPor === "resp") pre.responsavelId = l.chave === SEM_RESPONSAVEL ? null : l.chave;
    if (agruparPor === "status") pre.status = l.chave as StatusTarefa;
    if (agruparPor === "prio") pre.prioridade = l.chave as PrioridadeTarefa;
    if (agruparPor === "etiqueta" && l.chave !== SEM_ETIQUETA) pre.etiquetas = [l.chave];
    return pre;
  }

  // Atalhos (spec §4): C cria, F filtro, D exibição, V quadro/lista, S/P/A na tarefa sob o mouse ou selecionada, 1–6 status, Esc. Nunca dentro de campos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvoEl = e.target as HTMLElement | null;
      if (alvoEl && (["INPUT", "TEXTAREA", "SELECT"].includes(alvoEl.tagName) || alvoEl.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const t = selecionada ? porId.get(selecionada) : undefined;
      if (k === "escape") {
        if (menu || atalho) {
          setMenu(null);
          setAtalho(null);
        } else if (abertaId) setAbertaId(null);
        else if (criarEm) setCriarEm(null);
        else setSelecionada(null);
        return;
      }
      if (k === "c") {
        e.preventDefault();
        return setCriarEm({ coluna: "", pre: { status: "A_FAZER", responsavelId: null } });
      }
      if (k === "f") {
        e.preventDefault();
        return setMenu({ tipo: "filtro", ancora: refFiltro.current });
      }
      if (k === "d" && !t) {
        e.preventDefault();
        return setMenu({ tipo: "exibicao", ancora: refExibicao.current });
      }
      if (k === "v") return mudarExibicao({ ...exibicao, vista: exibicao.vista === "quadro" ? "lista" : "quadro" });
      if (!t) return;
      if (k === "s") return abrirAtalho(t.id, "status");
      if (k === "p") return abrirAtalho(t.id, "prio");
      if (k === "a") return abrirAtalho(t.id, "resp");
      // Enter/espaço só do "nada" (body): num cartão, linha ou botão focado a tecla é dele (abrir, pegar para arrastar, clicar).
      if ((k === "enter" || k === " ") && (!alvoEl || alvoEl === document.body)) {
        e.preventDefault();
        return setAbertaId(t.id);
      }
      if (/^[1-6]$/.test(k)) return editar(t.id, { status: COLUNAS[Number(k) - 1].status });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const mostrarAvatar = agruparPor !== "resp";
  const tarefaAtalho = atalho ? porId.get(atalho.id) : undefined;
  const aoCriar = (t?: TarefaLista) => {
    setCriarEm(null);
    if (t) setTarefas((ts) => [...ts, t]);
  };

  return (
    <>
      <BarraTarefas filtros={filtros} onMudarFiltros={mudarFiltros} exibicao={exibicao} onMudarExibicao={mudarExibicao} pessoas={pessoas} etiquetas={etiquetas} visiveis={visiveis.length} total={tarefas.length} refFiltro={refFiltro} refExibicao={refExibicao} menuAberto={menu} onMenu={setMenu} />
      {erro ? (
        <div className="mb-3 rounded-lg border border-danger/50 bg-surface px-3 py-2">
          <MensagemErro falha={erro} className="text-sm" />
        </div>
      ) : null}
      {criarEm && criarEm.coluna === "" ? (
        <div className="mb-3 max-w-xl">
          <NovaTarefa projetoId={projetoId} pre={criarEm.pre} onFim={aoCriar} onErro={setErro} />
        </div>
      ) : null}
      {tarefas.length === 0 ? (
        <EstadoVazio mascote="cabeca" tamanho="sm" className="mb-4 shrink-0 rounded-xl border border-border bg-surface" titulo="Nenhuma tarefa ainda" texto="Crie a primeira pelo + de uma coluna ou com a tecla C." />
      ) : visiveis.length === 0 ? (
        <EstadoVazio
          mascote="cabeca"
          tamanho="sm"
          className="mb-4 shrink-0 rounded-xl border border-border bg-surface"
          titulo="Nenhuma tarefa com esses filtros"
          acao={
            <Button variant="outline" size="sm" onClick={() => mudarFiltros(FILTROS_VAZIOS)}>
              Limpar filtros
            </Button>
          }
        />
      ) : null}

      <div ref={refQuadro} className="-mx-4 flex min-h-0 flex-1 overflow-auto px-4 pb-2 md:-mx-8 md:px-8">
        <DndContext
          id={`tarefas-${projetoId}`}
          sensors={sensors}
          collisionDetection={colisaoQuadro}
          // Faixas (quadro) e grupos vazios (lista) aparecem durante o arrasto: re-mede os alvos.
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={fimArrasto}
        >
          {exibicao.vista === "lista" ? (
            <ListaTarefas linhas={grupos} porId={porId} pessoaPorId={pessoaPorId} pessoas={pessoas} exibicao={exibicao} hoje={hoje} selecionada={selecionada} fechados={fechados} onAlternarGrupo={alternarGrupo} onAbrir={setAbertaId} onSelecionar={setSelecionada} onEditar={editar} onNovo={(l) => setCriarEm({ coluna: "", pre: preDe(l) })} arrastando={arrastando} />
          ) : (
            <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 md:snap-none">
              {grupos.map((g) => {
                const colapsada = !abertas.has(g.chave);
                return colapsada ? (
                  <ColunaColapsada
                    key={g.chave}
                    grupo={g}
                    agruparPor={agruparPor}
                    onExpandir={() => abrirColuna(g.chave)}
                    onNovo={() => {
                      abrirColuna(g.chave);
                      setCriarEm({ coluna: g.chave, pre: preDe(g) });
                    }}
                  />
                ) : (
                  <Coluna
                    key={g.chave}
                    grupo={g}
                    agruparPor={agruparPor}
                    porId={porId}
                    pessoaPorId={pessoaPorId}
                    subtarefasDe={subtarefasDe}
                    exibicao={exibicao}
                    mostrarAvatar={mostrarAvatar}
                    hoje={hoje}
                    selecionada={selecionada}
                    onAbrir={setAbertaId}
                    onSelecionar={setSelecionada}
                    onRecolher={arrastando ? undefined : () => recolherColuna(g.chave)}
                    onNovo={() => setCriarEm({ coluna: g.chave, pre: preDe(g) })}
                    criando={criarEm?.coluna === g.chave ? <NovaTarefa projetoId={projetoId} pre={criarEm.pre} onFim={aoCriar} onErro={setErro} /> : null}
                  />
                );
              })}
            </div>
          )}
          <DragOverlay>
            {ativa && exibicao.vista === "lista" ? (
              <div className="flex h-10 w-[28rem] items-center gap-3 rounded-lg border border-border-strong bg-surface px-4 text-sm shadow-lg shadow-black/40">
                <IconeStatus status={ativa.status} className="size-3.5" />
                <span className="font-mono text-[11px] text-fg-mute">#{ativa.numero}</span>
                <span className="truncate">{ativa.titulo}</span>
              </div>
            ) : ativa ? (
              <div className="w-72">
                <CartaoTarefa tarefa={ativa} pessoa={pessoaPorId.get(ativa.responsavelId ?? "")} subtarefas={subtarefasDe(ativa.id)} mostrarAvatar={mostrarAvatar} props={exibicao.props} dens={exibicao.dens} hoje={hoje} arrastando />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {atalho && tarefaAtalho ? (
        <MenuOpcoes
          ancora={atalho.ancora}
          titulo={atalho.campo === "status" ? "Mudar status" : atalho.campo === "prio" ? "Prioridade" : "Responsável"}
          busca={atalho.campo === "resp"}
          opcoes={
            atalho.campo === "status"
              ? COLUNAS.map((c, i) => ({ valor: c.status, rotulo: c.nome, icone: <IconeStatus status={c.status} className="size-3.5" />, atalho: String(i + 1) }))
              : atalho.campo === "prio"
                ? PRIORIDADES.map((p) => ({ valor: p.k, rotulo: p.nome, icone: <IconePrioridade prioridade={p.k} className="size-3.5" /> }))
                : [{ valor: "", rotulo: "Sem responsável" }, ...pessoas.filter((p) => recebeTarefa(p) || p.id === tarefaAtalho.responsavelId).map((p) => ({ valor: p.id, rotulo: rotuloResponsavel(p), icone: <Avatar nome={p.nome} usuarioId={p.id} fotoEm={p.fotoEm} className="size-4 text-[8px]" /> }))]
          }
          selecionadas={[atalho.campo === "status" ? tarefaAtalho.status : atalho.campo === "prio" ? tarefaAtalho.prioridade : (tarefaAtalho.responsavelId ?? "")]}
          onEscolher={(v) => editar(atalho.id, atalho.campo === "status" ? { status: v as StatusTarefa } : atalho.campo === "prio" ? { prioridade: v as PrioridadeTarefa } : { responsavelId: v || null })}
          onFechar={() => setAtalho(null)}
        />
      ) : null}
      <DetalheTarefa
        projetoId={projetoId}
        tarefa={aberta}
        pessoas={pessoas}
        etiquetasSugeridas={etiquetas}
        onFechar={() => setAbertaId(null)}
        onMudou={aplicar}
        onExcluida={(id) => {
          setAbertaId(null);
          setTarefas((ts) => ts.filter((t) => t.id !== id && t.paiId !== id));
        }}
      />
    </>
  );
}

/** Marca da coluna/grupo: ícone de status, de prioridade, avatar da pessoa ou ponto da etiqueta. */
function MarcaGrupo({ grupo: g, agruparPor }: { grupo: Linha<TarefaLista>; agruparPor: Exibicao["agrupar"] }) {
  if (agruparPor === "status") return <IconeStatus status={g.chave as StatusTarefa} className="size-3.5" />;
  if (agruparPor === "prio") return <IconePrioridade prioridade={g.chave as PrioridadeTarefa} className="size-3.5" />;
  if (g.pessoa) return <Avatar nome={g.pessoa.nome} usuarioId={g.pessoa.id} fotoEm={g.pessoa.fotoEm} className="size-5 text-[9px]" />;
  if (agruparPor === "etiqueta" && g.chave !== SEM_ETIQUETA) return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: corEtiqueta(g.chave) }} />;
  return <span className="size-2 shrink-0 rounded-full bg-fg-faint" />;
}

/** Coluna aberta (visual do Kanban): painel com cabeçalho, ocupa a altura toda; a lista de cards rola sozinha. */
function Coluna({
  grupo: g,
  agruparPor,
  porId,
  pessoaPorId,
  subtarefasDe,
  exibicao,
  mostrarAvatar,
  hoje,
  selecionada,
  onAbrir,
  onSelecionar,
  onRecolher,
  onNovo,
  criando,
}: {
  grupo: Linha<TarefaLista>;
  agruparPor: Exibicao["agrupar"];
  porId: Map<string, TarefaLista>;
  pessoaPorId: Map<string, PessoaTarefa>;
  subtarefasDe: (id: string) => { feitas: number; total: number } | null;
  exibicao: Exibicao;
  mostrarAvatar: boolean;
  hoje: string;
  selecionada: string | null;
  onAbrir: (id: string) => void;
  onSelecionar: (id: string | null) => void;
  onRecolher?: () => void;
  onNovo: () => void;
  criando: React.ReactNode;
}) {
  // A coluna inteira é o alvo do drop (inclusive o cabeçalho).
  const { setNodeRef, isOver } = useDroppable({ id: idColuna(g.chave) });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${g.nome}, ${g.tarefas.length} tarefa(s)`}
      className={cn("flex min-h-0 w-[85vw] max-w-72 shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/60 sm:w-72", isOver && "border-border-strong bg-surface/40")}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <MarcaGrupo grupo={g} agruparPor={agruparPor} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{g.nome}</h2>
        <span className="font-mono text-xs text-fg-faint tabular">{g.tarefas.length}</span>
        {onRecolher ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Recolher ${g.nome}`} title="Recolher" onClick={onRecolher}>
            <ChevronsLeftRight />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-xs" aria-label={`Nova tarefa em ${g.nome}`} title="Nova tarefa" onClick={onNovo}>
          <Plus />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2">
        {criando}
        {g.tarefas.map((t) => (
          <CartaoArrastavel key={t.id} tarefa={t} pai={t.paiId ? (porId.get(t.paiId) ?? null) : null} pessoa={pessoaPorId.get(t.responsavelId ?? "")} subtarefas={subtarefasDe(t.id)} exibicao={exibicao} mostrarAvatar={mostrarAvatar} hoje={hoje} selecionada={selecionada === t.id} onAbrir={() => onAbrir(t.id)} onSelecionar={() => onSelecionar(t.id)} />
        ))}
      </div>
    </section>
  );
}

/** Coluna recolhida (vazia, ou Backlog/Cancelada): faixa estreita, ainda aceita drop; abre ao clicar, ao criar ou ao arrastar por cima. */
function ColunaColapsada({ grupo: g, agruparPor, onExpandir, onNovo }: { grupo: Linha<TarefaLista>; agruparPor: Exibicao["agrupar"]; onExpandir: () => void; onNovo: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: idColuna(g.chave) });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${g.nome} (recolhida), ${g.tarefas.length} tarefa(s)`}
      className={cn("flex w-12 shrink-0 snap-start flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-muted/40 py-3 transition-colors", isOver && "border-solid border-border-strong bg-surface-hover ring-1 ring-border-strong")}
    >
      <Button variant="ghost" size="icon-xs" aria-label={`Nova tarefa em ${g.nome}`} title="Nova tarefa" onClick={onNovo}>
        <Plus />
      </Button>
      <button type="button" onClick={onExpandir} aria-label={`Expandir ${g.nome}`} title={`Expandir ${g.nome}`} className="flex flex-1 flex-col items-center gap-2 rounded-md px-1 pt-1 text-fg-mute outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <MarcaGrupo grupo={g} agruparPor={agruparPor} />
        <span className="font-mono text-xs tabular">{g.tarefas.length}</span>
        <span className="text-xs whitespace-nowrap [writing-mode:vertical-rl]">{g.nome}</span>
      </button>
    </section>
  );
}

function CartaoArrastavel({
  tarefa,
  pai,
  pessoa,
  subtarefas,
  exibicao,
  mostrarAvatar,
  hoje,
  selecionada,
  onAbrir,
  onSelecionar,
}: {
  tarefa: TarefaLista;
  pai: TarefaLista | null;
  pessoa?: PessoaTarefa;
  subtarefas: { feitas: number; total: number } | null;
  exibicao: Exibicao;
  mostrarAvatar: boolean;
  hoje: string;
  selecionada: boolean;
  onAbrir: () => void;
  onSelecionar: () => void;
}) {
  // Sem transform na origem: quem segue o ponteiro é o DragOverlay (com os dois, a cópia apagada ia junto e era cortada pela coluna).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tarefa.id });
  const alvo = useDroppable({ id: tarefa.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        alvo.setNodeRef(el);
      }}
      data-id={tarefa.id}
      className={cn("touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-40", alvo.isOver && !isDragging && "ring-1 ring-primary/60", selecionada && "ring-1 ring-primary/50")}
      {...attributes}
      aria-roledescription="tarefa arrastável"
      aria-label={`#${tarefa.numero} ${tarefa.titulo}. Pressione espaço para mover, Enter para abrir.`}
      {...listeners}
      onClick={onAbrir}
      onMouseEnter={onSelecionar}
      // Enter abre; espaço e setas seguem para o arrasto por teclado (sem isso o sensor de teclado nunca disparava).
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging) onAbrir();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <CartaoTarefa tarefa={tarefa} pai={pai} pessoa={pessoa} subtarefas={subtarefas} mostrarAvatar={mostrarAvatar} props={exibicao.props} dens={exibicao.dens} hoje={hoje} />
    </div>
  );
}

/** Criação rápida pelo título (Enter cria, Esc cancela), já com status, responsável, prioridade e etiqueta do lugar onde foi aberta. */
function NovaTarefa({ projetoId, pre, onFim, onErro }: { projetoId: string; pre: Pre; onFim: (t?: TarefaLista) => void; onErro: (f: FalhaUI | null) => void }) {
  const [titulo, setTitulo] = useState("");
  const [pendente, startTransition] = useTransition();
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = titulo.trim();
    if (!t) return onFim();
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof criarTarefaAction>>;
      try {
        r = await criarTarefaAction(projetoId, { titulo: t, ...pre });
      } catch {
        onErro(FALHA_CONEXAO);
        return;
      }
      const falha = falhaDe(r, "criar a tarefa");
      if (falha || !("ok" in r) || r.ok !== true || !r.id) return onErro(falha);
      onErro(null);
      onFim({ id: r.id, numero: r.numero ?? 0, titulo: t, descricao: null, status: pre.status, prioridade: pre.prioridade ?? "SEM_PRIORIDADE", posicao: Number.MAX_SAFE_INTEGER, responsavelId: pre.responsavelId, prazo: null, etiquetas: pre.etiquetas ?? [], paiId: null, concluidaEmMs: null, criadoEmMs: Date.now() });
    });
  }
  return (
    <form onSubmit={enviar} className="flex items-center gap-2 rounded-lg border border-ring/60 bg-background p-1.5 ring-2 ring-ring/25">
      <IconeStatus status={pre.status} className="ml-1 size-4" />
      <Input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onFim()} onBlur={() => !titulo.trim() && onFim()} placeholder={`Nova tarefa em ${ROTULO_STATUS[pre.status]} (Enter cria)`} aria-label="Título da nova tarefa" maxLength={TITULO_MAX} disabled={pendente} className="h-8 border-0 bg-transparent focus-visible:ring-0" />
    </form>
  );
}
