"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";
import { enviarContratoDoHandoff } from "@/lib/projetos/handoff-cliente";
import { CAMPOS_RESUMO, descreverPendencias, ITENS_MANUAIS, RESUMO_CAMPO_MAX, ROTULO_ITEM, ROTULO_RESUMO, type CampoResumo } from "@/lib/projetos/handoff-regras";
import type { VisaoHandoff } from "@/lib/projetos/handoff";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { definirContratoAction, designarGpAction, marcarItemAction, moverParaExecucaoAction, salvarResumoAction } from "./handoff-actions";

type Props = {
  cardId: string;
  handoff: VisaoHandoff;
  somenteLeitura: boolean;
  podeDesignar: boolean;
  podeResumo: boolean;
  /** GAB-98: itens e contrato, etapa conjunta (`podeEditarChecklistHandoff`). */
  podeEditar?: boolean;
  /** GAB-98: Mover para Execução é de quem edita o card (área dona ou responsável). */
  podeMover?: boolean;
  /** GAB-98: link e versão da proposta só para quem a vê. */
  veProposta?: boolean;
  candidatosGp: { id: string; nome: string }[];
  /** Ninguém ativo tem o cargo de PM de projetos: ninguém consegue designar. */
  semGpDeProjetos: boolean;
  /** PDFs já anexados ao Projeto, para apontar qual é o contrato. */
  pdfs: { id: string; nome: string }[];
};

const CAMPO = "w-full rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Bloco "Handoff" do Projeto (GAB-93, spec §4.8). As regras são do servidor; aqui só se mostra o que cabe a quem vê. */
export function HandoffDoProjeto({ cardId, handoff: h, somenteLeitura, podeDesignar, podeResumo, podeEditar = true, podeMover = true, veProposta = true, candidatosGp, semGpDeProjetos, pdfs }: Props) {
  const router = useRouter();
  const editavel = h.emHandoff && !somenteLeitura;
  const editaItens = editavel && podeEditar;
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const [gpId, setGpId] = useState(h.gp?.id ?? "");
  const [pdfId, setPdfId] = useState("");
  // Só o que esta pessoa editou: o resto vem do servidor, então o que outra pessoa salvou não é sobrescrito.
  const [edicoes, setEdicoes] = useState<Partial<Record<CampoResumo, string>>>({});
  const arquivo = useRef<HTMLInputElement>(null);

  function agir(chamar: () => Promise<RespostaAcao>, acao: string, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      const falha = await executarAcao(chamar, acao);
      setErro(falha);
      if (!falha) {
        depois?.();
        router.refresh();
      }
    });
  }

  function aoEscolherPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // o mesmo arquivo pode ser escolhido de novo depois de um erro
    if (f) agir(() => enviarContratoDoHandoff(cardId, f), "anexar o contrato");
  }

  const partesAlteradas = Object.fromEntries(CAMPOS_RESUMO.flatMap((c) => (edicoes[c] !== undefined && edicoes[c].trim() !== h.resumo[c] ? [[c, edicoes[c]]] : []))) as Partial<Record<CampoResumo, string>>;
  const mudouResumo = Object.keys(partesAlteradas).length > 0;
  const opcoesGp = h.gp && !candidatosGp.some((c) => c.id === h.gp!.id) ? [{ id: h.gp.id, nome: `${h.gp.nome} (não pode mais ser GP)` }, ...candidatosGp] : candidatosGp;

  return (
    <section aria-label="Handoff" className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Handoff</h2>
        <span className="font-mono text-[11px] text-fg-mute uppercase">{h.completo ? "completo" : h.isento ? "dispensado" : "em aberto"}</span>
        <span className="flex-1" />
        {editavel && podeMover ? (
          <Button type="button" size="sm" disabled={pendente || (!h.completo && !h.isento)} onClick={() => agir(() => moverParaExecucaoAction(cardId), "mover para Execução")}>
            Mover para Execução
          </Button>
        ) : null}
      </div>
      {h.isento ? (
        <p className="mt-1 text-xs text-fg-mute">Card anterior a esta etapa: pode entrar em Execução sem fechar o handoff. Preencher é opcional.</p>
      ) : !h.completo && h.emHandoff ? (
        <p className="mt-1 text-xs text-fg-mute">Para entrar em Execução, falta: {descreverPendencias(h.pendencias)}. Nem a gestão força.</p>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-xs font-medium text-fg-soft">GP do projeto (em geral, o PO)</h3>
            {editavel && podeDesignar ? (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="GP do projeto" value={gpId} onChange={(e) => setGpId(e.target.value)} disabled={pendente} className={`${CAMPO} max-w-64`}>
                  <option value="">Escolha…</option>
                  {opcoesGp.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" disabled={pendente || !gpId || (gpId === h.gp?.id && !h.responsavelDiverge)} onClick={() => agir(() => designarGpAction(cardId, gpId), "designar o GP")}>
                  Designar
                </Button>
              </div>
            ) : (
              <p className="text-sm">{h.gp ? h.gp.nome : <span className="text-fg-mute">Ainda não designado (quem designa é o PM de projetos).</span>}</p>
            )}
            {h.gp && !h.gpValido ? <p className="mt-1 text-xs text-danger">Essa pessoa não está mais ativa na área de projetos: é preciso designar outra.</p> : null}
            {h.gpValido && h.responsavelDiverge ? <p className="mt-1 text-xs text-danger">O responsável pelo projeto mudou e não é mais o GP: designe de novo para corrigir.</p> : null}
            {semGpDeProjetos ? <p className="mt-1 text-xs text-danger">Ninguém tem o cargo de PM de projetos, então ninguém consegue designar. Peça à gestão para dar esse cargo a alguém.</p> : null}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-medium text-fg-soft">Checklist</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <input type="checkbox" aria-label="Proposta final congelada" checked={h.proposta.congelada || h.proposta.dispensada} disabled readOnly className="mt-1" />
                <span>
                  Proposta final congelada{" "}
                  <span className="text-xs text-fg-mute">
                    {h.proposta.congelada ? `(automático${h.proposta.versao && veProposta ? `, v${h.proposta.versao}` : ""})` : h.proposta.dispensada ? "(dispensada: card sem proposta aceita no sistema)" : "(automático)"}
                  </span>{" "}
                  {veProposta ? (
                    <Link href={`/projetos/${cardId}/proposta`} className="text-xs underline decoration-fg-faint underline-offset-2 hover:text-foreground">
                      ver
                    </Link>
                  ) : null}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <input type="checkbox" aria-label="PDF do contrato assinado" checked={!!h.contrato} disabled readOnly className="mt-1" />
                <div className="min-w-0 flex-1">
                  PDF do contrato assinado{" "}
                  {h.contrato ? (
                    <a href={`/api/anexos/${h.contrato.id}`} download className="text-xs underline decoration-fg-faint underline-offset-2 hover:text-foreground">
                      {h.contrato.nome}
                    </a>
                  ) : null}
                  {editaItens ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <input ref={arquivo} type="file" accept=".pdf,application/pdf" aria-label="Anexar PDF do contrato" className="sr-only" onChange={aoEscolherPdf} disabled={pendente} />
                      <Button type="button" variant="outline" size="xs" disabled={pendente} onClick={() => arquivo.current?.click()}>
                        {h.contrato ? "Trocar por outro PDF" : "Anexar PDF"}
                      </Button>
                      {pdfs.some((p) => p.id !== h.contrato?.id) ? (
                        <>
                          <select aria-label="PDF já anexado" value={pdfId} onChange={(e) => setPdfId(e.target.value)} disabled={pendente} className={`${CAMPO} max-w-56 py-0.5 text-xs`}>
                            <option value="">PDF já anexado…</option>
                            {pdfs
                              .filter((p) => p.id !== h.contrato?.id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nome}
                                </option>
                              ))}
                          </select>
                          <Button type="button" variant="outline" size="xs" disabled={pendente || !pdfId} onClick={() => agir(() => definirContratoAction(cardId, pdfId), "definir o contrato", () => setPdfId(""))}>
                            É este
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
              {ITENS_MANUAIS.map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <input
                    id={`handoff-${i}`}
                    type="checkbox"
                    checked={!!h.itens[i]}
                    disabled={!editaItens || pendente}
                    onChange={(e) => {
                      const feito = e.target.checked;
                      agir(() => marcarItemAction(cardId, i, feito), "atualizar o checklist");
                    }}
                    className="mt-1"
                  />
                  <label htmlFor={`handoff-${i}`}>{ROTULO_ITEM[i]}</label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-soft">
            Resumo de handoff <span className="font-normal text-fg-mute">(escrito por vendas)</span>
          </h3>
          <div className="space-y-3">
            {CAMPOS_RESUMO.map((c) => (
              <div key={c}>
                <label htmlFor={`resumo-${c}`} className="mb-1 block text-xs text-fg-mute">
                  {ROTULO_RESUMO[c]}
                </label>
                {editavel && podeResumo ? (
                  <textarea
                    id={`resumo-${c}`}
                    rows={3}
                    maxLength={RESUMO_CAMPO_MAX}
                    value={edicoes[c] ?? h.resumo[c]}
                    disabled={pendente}
                    onChange={(e) => setEdicoes((r) => ({ ...r, [c]: e.target.value }))}
                    className={`${CAMPO} resize-y`}
                  />
                ) : (
                  <p id={`resumo-${c}`} className="whitespace-pre-wrap text-sm break-words">
                    {h.resumo[c] || <span className="text-fg-faint">—</span>}
                  </p>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-fg-faint">{h.resumoEm ? `${h.resumoPor ?? "alguém"} · ${formatarDataHora(h.resumoEm)}` : null}</p>
              {editavel && podeResumo ? (
                <Button type="button" size="sm" variant="outline" disabled={pendente || !mudouResumo} onClick={() => agir(() => salvarResumoAction(cardId, partesAlteradas), "salvar o resumo", () => setEdicoes({}))}>
                  Salvar resumo
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <MensagemErro falha={erro} className="mt-3" />
    </section>
  );
}
