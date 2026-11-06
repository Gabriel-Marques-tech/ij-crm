"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolhaProvider } from "@/components/propostas/bloco-dados-view";
import type { ControleEditor } from "@/components/propostas/editor-texto";
import type { DadosCapa } from "@/components/propostas/folha";
import { ancoraDoElemento, toposNoEditor, transacaoDeSugestao } from "@/components/propostas/destaques-editor";
import { BotaoComentarTrecho, useComentarios, useDestaquesDoEditor, type ThreadJson } from "./comentarios-contexto";
import { Autosave, type EstadoAutosave, type RespostaGravacao } from "@/lib/propostas/autosave";
import { herdarBlocos, normalizarDocumento, type Documento } from "@/lib/propostas/documento";
import { ESTRUTURADO_VAZIO, formularioGravavel, interpretarEstruturado, paraEnvio, type Estruturado } from "@/lib/propostas/estruturado";
import { urlPreviaDaProposta } from "@/lib/propostas/url";
import { mensagemConflito, NOTA_VERSAO_MAX } from "@/lib/propostas/regras";
import type { AcaoCaneta } from "@/lib/propostas/caneta";
import type { AcaoEnvio } from "@/lib/propostas/envio";
import { AcoesCaneta, type AcaoTela, type PessoaCaneta, type Preparo } from "./acoes-caneta";
import { mesclarSugestao, type CamposSugeridos } from "@/lib/propostas/sugestao";
import { aplicarSugestaoAction, salvarEstruturadoAction, salvarTextoAction, salvarVersaoAction, type ConflitoUI } from "./actions";
import { AvisosDosDados } from "./estruturado-leitura";
import { FormEstruturado, type FormEstruturadoValor } from "./form-estruturado";
import { GradeFolha } from "./grade-folha";
import { PreencherDeArquivo, type AnexoBase } from "./preencher-de-arquivo";

// Tiptap só no navegador e só nesta página (fora do bundle do resto do app).
const EditorTexto = dynamic(() => import("@/components/propostas/editor-texto"), {
  ssr: false,
  loading: () => <div className="proposta-texto min-h-72 rounded-lg border border-input px-4 py-3 text-fg-faint">Carregando editor…</div>,
});

const ATRASO_AUTOSAVE_MS = 1200;

/** Dados como os blocos da folha mostram; enquanto o cartão está inválido, fica o último válido. */
const dadosDoForm = (f: FormEstruturadoValor, antes: Estruturado = ESTRUTURADO_VAZIO): Estruturado => {
  const r = interpretarEstruturado(paraEnvio(f));
  return r.ok ? r.valor : antes;
};

/** Forma canônica: só mudança que vai para o Markdown agenda gravação (o parágrafo vazio de depois do bloco não vai). */
const canonico = (d: Documento) => JSON.stringify(normalizarDocumento(d));

const chavesDe = (f: FormEstruturadoValor) => f.entregas.flatMap((e) => (e.chaveNova ? [e.chaveNova] : []));

function SalvoHa({ em }: { em: Date }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((agora - em.getTime()) / 1000));
  return <span className="text-fg-mute">Salvo há {s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`}</span>;
}

/** Resposta da action → forma do Autosave (`INESPERADO` vira texto com a ref do log). */
function paraGravacao(r: Awaited<ReturnType<typeof salvarTextoAction>>): RespostaGravacao {
  if (r.ok === true) return { ok: true, revisao: r.revisao };
  if (r.erro === "INESPERADO") return { ok: false, erro: "Não foi possível salvar. Erro no servidor.", ref: "ref" in r ? r.ref : undefined };
  return { ok: false, erro: r.erro, ...("conflito" in r && r.conflito ? { conflito: r.conflito } : {}), ...("semMudancas" in r && r.semMudancas ? { informativo: true } : {}) };
}

function Status({ estado, tentar, sujo }: { estado: EstadoAutosave; tentar: () => void; sujo: boolean }) {
  switch (estado.tipo) {
    case "salvo":
      if (sujo) return <span className="text-fg-mute">Alterações não salvas…</span>;
      return estado.em ? <SalvoHa key={estado.em.getTime()} em={estado.em} /> : <span className="text-fg-faint">Rascunho salvo</span>;
    case "pendente":
      return <span className="text-fg-mute">Alterações não salvas…</span>;
    case "salvando":
      return <span className="text-fg-mute">Salvando…</span>;
    case "erro":
      return (
        <span role="alert" className="text-danger">
          {estado.texto}
          {estado.ref ? (
            <>
              {" "}
              <span className="text-fg-soft">
                (ref: <code className="font-mono select-all">{estado.ref}</code>)
              </span>
            </>
          ) : null}{" "}
          <button type="button" onClick={tentar} className="underline underline-offset-2">
            Tentar de novo
          </button>
        </span>
      );
    case "conflito":
      return <span className="text-warn">Conflito de edição — veja abaixo</span>;
  }
}

/**
 * Edição da proposta: texto (autosave), parte estruturada e "Salvar versão".
 * Tudo grava pela mesma fila (`Autosave`) com a revisão atual; conflito com
 * outra aba/pessoa/o MCP nunca sobrescreve sem a pessoa escolher.
 * Só aparece para o dono da caneta (GAB-87), com as ações dela no fim.
 */
export function PainelProposta({
  projetoId,
  revisao,
  documento,
  estruturado,
  ultimaVersao,
  caneta,
  anexos = [],
  capa,
  cartaoProposta,
  cartoesFim,
}: {
  projetoId: string;
  revisao: number;
  documento: Documento;
  estruturado: FormEstruturadoValor;
  ultimaVersao: number | null;
  caneta?: { acoes: AcaoCaneta[]; mesmoLado: PessoaCaneta[]; outroLado: PessoaCaneta[]; rotuloOutroLado: string; envio?: AcaoEnvio[]; versaoPdf?: number | null };
  /** Anexos do Projeto para "Usar arquivo como base" (GAB-90). */
  anexos?: AnexoBase[];
  /** GAB-100: capa da folha e os cartões da coluna direita que vêm do servidor. */
  capa?: DadosCapa;
  cartaoProposta?: ReactNode;
  cartoesFim?: ReactNode;
}) {
  const router = useRouter();
  const editor = useRef<ControleEditor>(null);
  // GAB-91: comentários (null fora do provider): trechos destacados no editor e "Comentar trecho" pela seleção.
  const comentarios = useComentarios();
  const destaques = useDestaquesDoEditor();
  const registrarFonte = comentarios?.registrarFonte;
  const registrarAplicador = comentarios?.registrarAplicador;
  const informarTexto = comentarios?.informarTexto;
  useEffect(
    () =>
      registrarFonte?.({
        selecao: () => editor.current?.selecao?.() ?? null,
        doElemento: (el) => {
          const e = editor.current?.editor?.();
          return e ? ancoraDoElemento(e.view, el) : null;
        },
        topos: (itens) => {
          const e = editor.current?.editor?.();
          return e ? toposNoEditor(e.view, itens) : {};
        },
      }),
    [registrarFonte],
  );
  const [estado, setEstado] = useState<EstadoAutosave>({ tipo: "salvo", em: null });
  // Props só na montagem: o `router.refresh()` (depois de salvar versão) traz props novas
  // e elas não podem atropelar o que está no editor/cartão.
  const [inicial] = useState(documento);
  // O texto do editor é o que vale para "trecho alterado" nesta tela.
  useEffect(() => informarTexto?.(inicial), [informarTexto, inicial]);
  const [form, setForm] = useState(estruturado);
  const [dados, setDados] = useState(() => dadosDoForm(estruturado));
  const [formSujo, setFormSujo] = useState(false);
  const [dadosPendentes, setDadosPendentes] = useState<string | null>(null);
  const [gravandoDados, setGravandoDados] = useState(false);
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();
  const [autosave] = useState(
    () =>
      new Autosave<Documento>({
        revisao,
        atrasoMs: ATRASO_AUTOSAVE_MS,
        salvarTexto: async (rev, doc) => paraGravacao(await salvarTextoAction(projetoId, rev, doc)),
        aoMudar: setEstado,
      }),
  );
  // O que as gravações em andamento leem depois de um `await`: o estado do render já pode estar velho.
  const atual = useRef({ form: estruturado, salvo: estruturado, sujo: false, versao: 0 });
  const timerDados = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último texto canônico que passou pelo editor: o parágrafo depois do bloco e a abertura não são edição.
  const ultimoTexto = useRef(canonico(documento));
  const folha = useMemo(() => ({ dados, comentar: comentarios?.citar }), [dados, comentarios?.citar]);

  const pararTimerDados = () => {
    if (timerDados.current) clearTimeout(timerDados.current);
    timerDados.current = null;
  };
  /** Gravou: o que foi é o novo `salvo`, e as linhas que foram junto deixam de ser novas. */
  const confirmarSalvo = useCallback((enviado: FormEstruturadoValor, chaves: readonly string[]) => {
    atual.current.salvo = enviado;
    if (chaves.length === 0) return;
    const limpar = (f: FormEstruturadoValor) => ({
      ...f,
      entregas: f.entregas.map((e) => {
        if (!e.chaveNova || !chaves.includes(e.chaveNova)) return e;
        const { titulo, dia, duracao, valor } = e;
        return { titulo, dia, duracao, valor };
      }),
    });
    atual.current.form = limpar(atual.current.form);
    setForm(limpar);
  }, []);

  /** O que dá para gravar agora, deixando de fora só o que está incompleto. */
  const gravarParteValida = useCallback(async () => {
    const { form: f, salvo, sujo } = atual.current;
    if (!sujo) return;
    const { form: g, chaves } = formularioGravavel(f, salvo);
    if (JSON.stringify(g) === JSON.stringify(salvo)) return;
    const r = await autosave.executar(async (rev) => paraGravacao(await salvarEstruturadoAction(projetoId, rev, g)));
    if (r?.ok) confirmarSalvo(g, chaves);
  }, [autosave, projetoId, confirmarSalvo]);

  // Saiu da tela (link, caneta mudou de mão): grava o que está pendente em vez de perder.
  useEffect(() => {
    const timer = timerDados;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void autosave.agora();
      void gravarParteValida();
    };
  }, [autosave, gravarParteValida]);

  function marcarLimpo(versao?: number) {
    if (versao !== undefined && versao !== atual.current.versao) return; // mudou de novo enquanto gravava
    atual.current.sujo = false;
    setFormSujo(false);
  }

  /** Grava os dados do cartão pela mesma fila e `revisao` do texto. Incompleto não vai: fica no cartão com o motivo. */
  async function gravarDados(): Promise<{ erro: string } | null> {
    pararTimerDados();
    if (!atual.current.sujo) return null;
    const { form: comMarcas, versao } = atual.current;
    const f = paraEnvio(comMarcas);
    const v = interpretarEstruturado(f);
    if (!v.ok) {
      setDadosPendentes(v.erro);
      return { erro: v.erro };
    }
    setDadosPendentes(null);
    setGravandoDados(true);
    const r = await autosave.executar(async (rev) => paraGravacao(await salvarEstruturadoAction(projetoId, rev, f)));
    setGravandoDados(false);
    if (r?.ok) {
      confirmarSalvo(f, chavesDe(comMarcas));
      marcarLimpo(versao);
      return null;
    }
    return { erro: r?.erro ?? "Os dados da proposta não foram salvos (veja o aviso no texto)." };
  }

  function mudarForm(v: FormEstruturadoValor) {
    atual.current = { ...atual.current, form: v, sujo: true, versao: atual.current.versao + 1 };
    setForm(v);
    setFormSujo(true);
    setDados((a) => dadosDoForm(v, a));
    setAviso(null);
    pararTimerDados();
    timerDados.current = setTimeout(() => void gravarDados(), ATRASO_AUTOSAVE_MS);
  }

  function formDoServidor(v: FormEstruturadoValor) {
    pararTimerDados();
    atual.current = { form: v, salvo: v, sujo: false, versao: atual.current.versao + 1 };
    setForm(v);
    setFormSujo(false);
    setDados((a) => dadosDoForm(v, a));
    setDadosPendentes(null);
  }

  // Fechar/recarregar com texto ainda não gravado: o navegador pergunta.
  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => {
      if (autosave.temPendencia || atual.current.sujo) e.preventDefault();
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [autosave]);

  const conflito = estado.tipo === "conflito" ? (estado.conflito as unknown as ConflitoUI) : null;

  function salvarVersao() {
    setAviso(null);
    pararTimerDados();
    startTransition(async () => {
      let numero: number | undefined;
      const { versao, sujo, form: comMarcas } = atual.current;
      const f = paraEnvio(comMarcas);
      const r = await autosave.executar(async (rev) => {
        const resp = await salvarVersaoAction(projetoId, rev, {
          documento: editor.current?.documento(),
          ...(sujo ? { estruturado: f } : {}),
          nota,
        });
        if (resp.ok === true) numero = resp.numero;
        return paraGravacao(resp);
      }, true);
      if (r && r.ok !== true && r.informativo) {
        // Nada mudou desde a última versão: avisa, e o que estava pendente segue o caminho normal.
        setAviso(r.erro);
        if (sujo) void gravarDados();
      }
      if (r?.ok) {
        if (sujo) confirmarSalvo(f, chavesDe(comMarcas));
        setNota("");
        marcarLimpo(versao);
        setDadosPendentes(null);
        setAviso(`Versão v${numero} salva.`);
        router.refresh();
      }
    });
  }

  /** Prévia do que está na folha. Abre a aba antes do `await`: depois dele o navegador bloquearia. */
  async function verPdf() {
    const aba = window.open("about:blank", "_blank");
    await autosave.agora();
    const textoFora = autosave.situacao.tipo === "erro" || autosave.situacao.tipo === "conflito";
    const f = await gravarDados();
    if (textoFora) setAviso("O PDF mostra o último rascunho salvo: o texto da tela não foi gravado (veja o aviso na barra).");
    else if (f) setAviso(`Os dados do cartão não entraram na prévia: ${f.erro}`);
    if (aba) aba.location.href = urlPreviaDaProposta("", projetoId);
    else setAviso("O navegador bloqueou a nova aba: permita pop-ups para ver o PDF.");
  }

  /**
   * Antes de passar/devolver/concordar: grava o texto pendente (a caneta vai sair
   * da mão) e confere que o rascunho está são. Devolver leva o editor e os dados
   * alterados junto (a versão entregue é o que está na tela). Nas demais, os dados
   * pendentes são gravados antes, e dado incompleto segura a ação: sumiria ao remontar.
   */
  async function preparar(acao: AcaoTela): Promise<Preparo> {
    await autosave.agora();
    const e = autosave.situacao;
    if (e.tipo === "conflito") return { erro: "Resolva o conflito de edição do rascunho antes." };
    if (e.tipo === "erro") return { erro: "O rascunho não foi salvo (veja o aviso no texto). Tente de novo antes." };
    if (acao === "concordar" && atual.current.sujo) return { erro: "Há dados da proposta alterados e não salvos: concordar é aceitar sem editar. Desfaça a alteração no cartão e aguarde salvar, ou salve a versão e devolva." };
    // Devolver e concluir a revisão (GAB-89) salvam a versão do que está na tela.
    if (acao === "devolver" || acao === "concluirRevisao") {
      pararTimerDados();
      return { revisao: autosave.revisaoAtual, documento: editor.current?.documento(), ...(atual.current.sujo ? { estruturado: paraEnvio(atual.current.form) } : {}) };
    }
    // Marcar inviável encerra a proposta: dado incompleto no cartão não pode impedir.
    if (acao === "inviavel") {
      pararTimerDados();
      await gravarParteValida();
      return { revisao: autosave.revisaoAtual };
    }
    const falha = await gravarDados();
    if (falha) return { erro: `Dados da proposta: ${falha.erro}` };
    return { revisao: autosave.revisaoAtual };
  }

  /**
   * GAB-90: a sugestão revisada entra no editor e no cartão e é gravada pelos MESMOS
   * caminhos da edição manual (autosave do texto e dos dados, na mesma fila e com a
   * revisão atual). Dados que a sugestão não preenche ficam como estão. Os blocos que
   * estão na folha continuam nela, no fim do texto novo (`herdarBlocos`, avisado antes de aplicar).
   */
  function aplicarSugestao(s: { documento: Documento; campos: CamposSugeridos }) {
    const agora = editor.current?.documento();
    const documentoNovo = agora ? herdarBlocos(s.documento, agora) : s.documento;
    editor.current?.substituir(documentoNovo);
    informarTexto?.(documentoNovo);
    ultimoTexto.current = canonico(documentoNovo);
    autosave.alterou(documentoNovo);
    mudarForm(mesclarSugestao(atual.current.form, s.campos));
    void gravarDados();
  }

  /**
   * GAB-101: aplica a sugestão pela mesma fila do autosave, levando o texto da tela (como "Salvar
   * versão"): `revisao`, conflito e a regra de edição são conferidos lá, junto com a resolução. O
   * editor fica travado durante a ida ao servidor, para ninguém digitar no trecho que está sendo
   * trocado, e o texto novo entra por uma transação: desfazer funciona, e o `onUpdate` passa pelo autosave.
   */
  const aplicarSugestaoDoComentario = useCallback(
    async (t: ThreadJson): Promise<string | null> => {
      const e = editor.current?.editor?.();
      if (!e || !t.ancora || !t.sugestao) return "O editor ainda não carregou. Tente de novo.";
      const { ancora, sugestao } = t;
      if (!transacaoDeSugestao(e.state, ancora, sugestao.texto)) return "O trecho mudou depois da sugestão: ela está desatualizada e não se aplica.";
      e.setEditable(false, false);
      try {
        let ref: string | undefined;
        const r = await autosave.executar(async (rev) => {
          const g = paraGravacao(await aplicarSugestaoAction(projetoId, t.id, rev, editor.current?.documento()));
          if (g.ok !== true) ref = g.ref;
          return g;
        }, true);
        if (!r) return "Resolva o conflito de edição do rascunho antes.";
        if (r.ok !== true) return ref ? `${r.erro} (ref: ${ref})` : r.conflito ? "Conflito de edição: escolha uma versão no aviso acima do texto e aplique de novo." : r.erro;
        const tr = transacaoDeSugestao(e.state, ancora, sugestao.texto);
        if (tr) e.view.dispatch(tr);
        return null;
      } finally {
        e.setEditable(true, false);
      }
    },
    [autosave, projetoId],
  );
  useEffect(() => registrarAplicador?.(aplicarSugestaoDoComentario), [registrarAplicador, aplicarSugestaoDoComentario]);

  function usarDoServidor(c: ConflitoUI) {
    editor.current?.substituir(c.documento);
    informarTexto?.(c.documento);
    ultimoTexto.current = canonico(c.documento);
    formDoServidor(c.estruturado);
    autosave.usarDoServidor(c.revisao);
  }

  /**
   * Mantém o que é MEU por cima da revisão nova. Dados sem alteração local passam a
   * ser os do servidor (senão o cartão velho, já com a revisão nova, desfaria a
   * mudança do outro na próxima gravação). Dados alterados aqui: a escolha diz
   * que sobrescreve também, e eles são gravados logo em seguida.
   */
  function manterMeu(c: ConflitoUI) {
    const doc = editor.current?.documento();
    if (!atual.current.sujo) formDoServidor(c.estruturado);
    startTransition(async () => {
      if (doc) await autosave.manterMeu(c.revisao, doc);
      await gravarDados();
    });
  }

  const tentarDeNovo = () => {
    void autosave.agora().then(() => gravarDados());
  };

  const statusSalvo = (
    <span className="font-mono text-[11px]" aria-live="polite">
      <Status estado={estado} tentar={tentarDeNovo} sujo={formSujo} />
    </span>
  );

  const centro = (
    <div className="min-w-0 space-y-3">
      <PreencherDeArquivo projetoId={projetoId} anexos={anexos} aoAplicar={aplicarSugestao} desativado={ocupado || conflito !== null} />
      {conflito ? (
        <div role="alert" className="rounded-lg border border-warn/60 bg-warn-soft p-3 text-sm">
          <p className="text-foreground">{mensagemConflito(conflito)}</p>
          <p className="mt-1 text-xs text-fg-mute">O seu texto continua no editor e não foi gravado. Escolha:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="xs" variant="outline" onClick={() => usarDoServidor(conflito)}>
              Carregar a versão atual (descarta a minha)
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => manterMeu(conflito)}>
              {formSujo ? "Manter os meus (texto e dados) e sobrescrever" : "Manter o meu texto e sobrescrever"}
            </Button>
          </div>
        </div>
      ) : null}
      <FolhaProvider value={folha}>
        <EditorTexto
          inicial={inicial}
          aoMudar={(d) => {
            const c = canonico(d);
            if (c === ultimoTexto.current) return;
            ultimoTexto.current = c;
            autosave.alterou(d);
            comentarios?.informarTexto(d);
          }}
          controle={editor}
          destaques={destaques}
          capa={capa}
          barraFim={
            <>
              <BotaoComentarTrecho compacto />
              {statusSalvo}
            </>
          }
        />
      </FolhaProvider>
    </div>
  );

  const secundarias = (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Button type="button" size="sm" variant="outline" className="min-w-0" disabled={ocupado || conflito !== null} onClick={salvarVersao}>
          Salvar versão
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-w-0" onClick={() => void verPdf()}>
          Ver PDF
        </Button>
      </div>
      <Input aria-label="Nota da versão (opcional)" placeholder="Nota da versão (opcional)" maxLength={NOTA_VERSAO_MAX} value={nota} onChange={(e) => setNota(e.target.value)} />
      <p className="text-[11px] text-fg-faint">Salvar versão congela o texto e os dados como {ultimaVersao ? `v${ultimaVersao + 1}` : "v1"}.</p>
      {aviso ? (
        <p role="status" className="text-xs text-fg-soft">
          {aviso}
        </p>
      ) : null}
    </>
  );

  const direita = (
    <>
      {caneta ? (
        <AcoesCaneta projetoId={projetoId} revisao={revisao} preparar={preparar} aoConcluir={(r) => autosave.adotarRevisao(r)} secundarias={secundarias} {...caneta} />
      ) : (
        <section className="space-y-2 rounded-xl border border-border bg-surface p-3" aria-label="Ações">
          {secundarias}
        </section>
      )}
      {cartaoProposta}
      <section className="rounded-xl border border-border bg-surface p-3" aria-label="Dados da proposta">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="eyebrow">Dados da proposta</h2>
          <span className="flex-1" />
          {gravandoDados ? <span className="font-mono text-[11px] text-fg-mute">Salvando…</span> : null}
        </div>
        <FormEstruturado valor={form} onChange={mudarForm} desativado={ocupado} />
        {dadosPendentes ? (
          <p role="status" className="mt-2 border-l-2 border-warn pl-2 text-xs text-fg-soft">
            Ainda não salvo: {dadosPendentes}
          </p>
        ) : null}
        <AvisosDosDados dados={dados} />
      </section>
      {cartoesFim}
    </>
  );

  return <GradeFolha centro={centro} direita={direita} />;
}
