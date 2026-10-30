"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ocorrenciasParaCsv } from "@/lib/importacao/pipefy/erros-csv";
import type { Ocorrencia } from "@/lib/importacao/pipefy/interpretar";
import type { Relatorio } from "@/lib/importacao/pipefy/aplicar";
import type { Previa } from "@/lib/importacao/pipefy/servico";
import { MOTIVOS_PERDA } from "@/lib/projetos/terminal-regras";
import { confirmarImportAction, remapearImportAction, type RespostaPrevia } from "./actions";

/** Mesmo teto do servidor (`LIMITE_BYTES`): avisa antes de subir 50 MB à toa. */
const LIMITE_BYTES = 8 * 1024 * 1024;
const ROTA_PREVIA = "/api/gestao/importar/previa";

const SELECT_CLASSE =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Quantas ocorrências aparecem na tela; o resto vai no CSV para baixar. */
const MAX_LISTA = 50;

type Falha = { ok: false; erro: string; ref?: string };
type Estado =
  | { etapa: "upload" }
  | { etapa: "previa"; token: string; expiraEm: string; previa: Previa }
  | { etapa: "relatorio"; relatorio: Relatorio };

function textoFalha(r: Falha): string {
  if (r.erro === "INESPERADO") return `Erro no servidor (ref: ${r.ref ?? "?"}). Tente de novo; se persistir, informe a ref.`;
  return r.ref ? `${r.erro} (ref: ${r.ref})` : r.erro;
}

/** Falha ao confirmar: parte pode ter sido gravada antes; o caminho é reenviar (reimport não duplica). */
function textoFalhaImport(r: Falha): string {
  if (r.erro === "INESPERADO") {
    return `O import falhou no servidor (ref: ${r.ref ?? "?"}). Parte dos cards pode ter sido gravada: envie o arquivo de novo — reimportar não duplica. Se persistir, informe a ref.`;
  }
  return textoFalha(r);
}

/** Upload pela rota (não por server action): limite próprio e erros em JSON. */
async function enviarArquivo(arquivo: File): Promise<RespostaPrevia> {
  if (arquivo.size > LIMITE_BYTES) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1).replace(".", ",");
    return { ok: false, erro: `Arquivo com ${mb(arquivo.size)} MB; o limite é ${mb(LIMITE_BYTES)} MB. Divida o export (por fase ou período) ou use o CLI.` };
  }
  let res: Response;
  try {
    res = await fetch(ROTA_PREVIA, {
      method: "POST",
      body: arquivo,
      headers: { "Content-Type": "text/csv", "X-Nome-Arquivo": encodeURIComponent(arquivo.name) },
    });
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor. Verifique a rede e tente de novo." };
  }
  try {
    const corpo = (await res.json()) as Partial<RespostaPrevia> & { erro?: string };
    // 401 do proxy (sem cookie) ou da rota (sessão inválida): `{ erro }` sem `ok`.
    if (res.status === 401) return { ok: false, erro: corpo.erro ?? "Sessão expirada. Entre de novo." };
    return corpo as RespostaPrevia;
  } catch {
    return { ok: false, erro: `Resposta inesperada do servidor (HTTP ${res.status}). Tente de novo.` };
  }
}

function baixarCsv(nome: string, erros: Ocorrencia[], avisos: Ocorrencia[]) {
  const csv = ocorrenciasParaCsv([...erros.map((o) => ({ ...o, tipo: "erro" as const })), ...avisos.map((o) => ({ ...o, tipo: "aviso" as const }))].sort((a, b) => a.linha - b.linha));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: "danger" | "warn" | "success" }) {
  const cor = tom === "danger" ? "text-danger" : tom === "warn" ? "text-warn" : tom === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className={`font-mono text-2xl ${cor}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-fg-mute">{rotulo}</p>
    </div>
  );
}

function ListaOcorrencias({ titulo, itens, tom }: { titulo: string; itens: Ocorrencia[]; tom: "danger" | "warn" }) {
  if (itens.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={titulo}>
      <h3 className={`text-sm font-medium ${tom === "danger" ? "text-danger" : "text-warn"}`}>
        {titulo} <span className="font-mono">({itens.length})</span>
      </h3>
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-3 text-sm">
        {itens.slice(0, MAX_LISTA).map((o, i) => (
          <li key={`${o.linha}-${i}`} className="flex gap-3">
            <span className="shrink-0 font-mono text-xs text-fg-faint">linha {o.linha}</span>
            {o.pipefyId ? <span className="shrink-0 font-mono text-xs text-fg-faint">#{o.pipefyId}</span> : null}
            <span className="text-fg-soft">{o.mensagem}</span>
          </li>
        ))}
        {itens.length > MAX_LISTA ? <li className="text-xs text-fg-faint">… e mais {itens.length - MAX_LISTA}. Baixe o CSV para ver todas.</li> : null}
      </ul>
    </section>
  );
}

export function ImportarPipefy() {
  const [estado, setEstado] = useState<Estado>({ etapa: "upload" });
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const campoArquivo = useRef<HTMLInputElement>(null);

  function enviar() {
    setErro(null);
    const arquivo = campoArquivo.current?.files?.[0];
    if (!arquivo || arquivo.size === 0) {
      setErro("Escolha o arquivo CSV exportado do Pipefy.");
      return;
    }
    iniciar(async () => {
      const r = await enviarArquivo(arquivo);
      if (r.ok) setEstado({ etapa: "previa", token: r.token, expiraEm: r.expiraEm, previa: r.previa });
      else setErro(textoFalha(r));
    });
  }

  if (estado.etapa === "upload") {
    return (
      <form action={enviar} className="max-w-xl space-y-4 rounded-xl border border-border bg-surface p-5">
        <div className="space-y-1.5">
          <Label htmlFor="arquivo">Arquivo CSV do Pipefy</Label>
          <input
            id="arquivo"
            name="arquivo"
            ref={campoArquivo}
            type="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm text-fg-soft file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
          <p className="text-xs text-fg-faint">No Pipefy: Relatórios → exportar cards (CSV). Separador `,` ou `;`, até 8 MB.</p>
        </div>
        {erro ? (
          <p role="alert" className="text-sm text-danger">
            {erro}
          </p>
        ) : null}
        <Button type="submit" disabled={pendente}>
          {pendente ? "Lendo arquivo…" : "Ver prévia"}
        </Button>
      </form>
    );
  }

  if (estado.etapa === "relatorio") {
    return <RelatorioFinal relatorio={estado.relatorio} onNovo={() => setEstado({ etapa: "upload" })} />;
  }

  return (
    <PreviaImport
      key={estado.token}
      token={estado.token}
      expiraEm={estado.expiraEm}
      previa={estado.previa}
      onNovaPrevia={(token, expiraEm, previa) => setEstado({ etapa: "previa", token, expiraEm, previa })}
      onImportado={(relatorio) => setEstado({ etapa: "relatorio", relatorio })}
      onCancelar={() => setEstado({ etapa: "upload" })}
    />
  );
}

function PreviaImport({
  token,
  expiraEm,
  previa,
  onNovaPrevia,
  onImportado,
  onCancelar,
}: {
  token: string;
  expiraEm: string;
  previa: Previa;
  onNovaPrevia: (token: string, expiraEm: string, previa: Previa) => void;
  onImportado: (r: Relatorio) => void;
  onCancelar: () => void;
}) {
  const inicial = useMemo(() => Object.fromEntries(previa.fases.map((f) => [f.chave, f.faseId ?? ""])), [previa.fases]);
  const [mapa, setMapa] = useState<Record<string, string>>(inicial);
  const motivoInicial = previa.opcoes.motivoPerdaPadrao ?? "";
  const [motivo, setMotivo] = useState<string>(motivoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const alterado = previa.fases.some((f) => (mapa[f.chave] ?? "") !== inicial[f.chave]) || motivo !== motivoInicial;
  const pipelines = useMemo(() => {
    const g = new Map<string, { nome: string; fases: Previa["fasesCrm"] }>();
    for (const f of previa.fasesCrm) {
      const p = g.get(f.pipelineChave) ?? { nome: f.pipelineNome, fases: [] };
      p.fases.push(f);
      g.set(f.pipelineChave, p);
    }
    return [...g.values()];
  }, [previa.fasesCrm]);
  const aImportar = previa.novos + previa.existentes;

  function remapear() {
    setErro(null);
    const m = Object.fromEntries(previa.fases.map((f) => [f.chave, mapa[f.chave] || null]));
    iniciar(async () => {
      const r = await remapearImportAction(token, m, { motivoPerdaPadrao: motivo || null });
      if (r.ok) onNovaPrevia(r.token, r.expiraEm, r.previa);
      else setErro(textoFalha(r));
    });
  }

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await confirmarImportAction(token, previa.hash);
      if (r.ok) onImportado(r.relatorio);
      else setErro(textoFalhaImport(r));
    });
  }

  const expira = new Date(expiraEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-mute">
        Prévia de <span className="font-mono text-fg-soft">{previa.nomeArquivo}</span> — nada foi gravado ainda. Válida até{" "}
        <span className="font-mono">{expira}</span>.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Numero rotulo="cards no arquivo" valor={previa.cards} />
        <Numero rotulo="novos" valor={previa.novos} tom="success" />
        <Numero rotulo="já existem (atualiza)" valor={previa.existentes} />
        <Numero rotulo="vão para Projetos" valor={previa.comProjeto} />
        <Numero rotulo="linhas repetidas" valor={previa.duplicadas} tom={previa.duplicadas ? "warn" : undefined} />
        <Numero rotulo="com erro (pulados)" valor={previa.erros.length} tom={previa.erros.length ? "danger" : undefined} />
      </div>

      <section className="space-y-2" aria-label="Mapeamento de fases">
        <h3 className="text-sm font-medium">Fases do Pipefy → fases do CRM</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-fg-mute">
              <tr>
                <th className="px-3 py-2 font-medium">Fase no Pipefy</th>
                <th className="px-3 py-2 text-right font-medium">Cards</th>
                <th className="px-3 py-2 font-medium">Fase no CRM</th>
              </tr>
            </thead>
            <tbody>
              {previa.fases.map((f) => (
                <tr key={f.chave} className="border-t border-border">
                  <td className="px-3 py-2">{f.nome}</td>
                  <td className="px-3 py-2 text-right font-mono">{f.cardsAtuais}</td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Fase do CRM para ${f.nome}`}
                      value={mapa[f.chave] ?? ""}
                      onChange={(e) => setMapa((m) => ({ ...m, [f.chave]: e.target.value }))}
                      className={SELECT_CLASSE}
                      disabled={pendente}
                    >
                      <option value="">— sem correspondência (cards pulados) —</option>
                      {pipelines.map((p) => (
                        <optgroup key={p.nome} label={p.nome}>
                          {p.fases.map((fc) => (
                            <option key={fc.id} value={fc.id}>
                              {fc.nome}
                              {fc.tipoTerminal === "GANHO" ? " (ganho)" : fc.tipoTerminal === "PERDIDO" ? " (perdido)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {previa.perdidosSemMotivo > 0 ? (
        <section className="space-y-2" aria-label="Perdidos sem motivo">
          <h3 className="text-sm font-medium text-warn">
            Perdidos sem motivo no export <span className="font-mono">({previa.perdidosSemMotivo})</span>
          </h3>
          <p className="text-xs text-fg-mute">
            O import não inventa motivo de perda. Sem escolha, esses cards ficam de fora (erro na linha). Se escolher, o motivo é gravado com o detalhe “Motivo
            definido na importação por você”.
          </p>
          <div className="max-w-sm">
            <select aria-label="Motivo para perdidos sem motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={SELECT_CLASSE} disabled={pendente}>
              <option value="">— pular esses cards —</option>
              {MOTIVOS_PERDA.map((m) => (
                <option key={m.chave} value={m.chave}>
                  {m.rotulo}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : null}

      {alterado ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-warn">Escolhas alteradas: recalcule a prévia antes de confirmar.</p>
          <Button type="button" size="sm" variant="outline" onClick={remapear} disabled={pendente}>
            Recalcular prévia
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setMapa(inicial);
              setMotivo(motivoInicial);
            }}
            disabled={pendente}
          >
            Desfazer
          </Button>
        </div>
      ) : null}

      {previa.responsaveisSemMatch.length > 0 ? (
        <section className="space-y-2" aria-label="Responsáveis sem usuário">
          <h3 className="text-sm font-medium text-warn">Responsáveis sem usuário no CRM</h3>
          <p className="text-xs text-fg-mute">Esses cards ficam com você (quem importa) e marcados para revisar.</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {previa.responsaveisSemMatch.map((r) => (
              <li key={r.nome} className="rounded-md border border-border bg-surface px-2 py-1">
                {r.nome} <span className="font-mono text-xs text-fg-faint">{r.cards}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ListaOcorrencias titulo="Linhas com erro (não serão importadas)" itens={previa.erros} tom="danger" />
      <ListaOcorrencias titulo="Avisos" itens={previa.avisos} tom="warn" />

      <details className="text-xs text-fg-mute">
        <summary className="cursor-pointer">Colunas lidas (separador “{previa.separador}”)</summary>
        <p className="mt-2">Reconhecidas: {previa.colunasReconhecidas.join(", ") || "—"}</p>
        <p>
          Colunas de histórico de fase: <span className="font-mono">{previa.colunasHistorico}</span>
        </p>
        <p>Ignoradas: {previa.colunasIgnoradas.join(", ") || "—"}</p>
      </details>

      {erro ? (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={confirmar} disabled={pendente || alterado || aImportar === 0}>
          {pendente ? "Processando…" : `Confirmar import (${aImportar} cards)`}
        </Button>
        {previa.erros.length + previa.avisos.length > 0 ? (
          <Button type="button" variant="outline" onClick={() => baixarCsv("previa-import-ocorrencias.csv", previa.erros, previa.avisos)}>
            Baixar erros (CSV)
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={pendente}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function RelatorioFinal({ relatorio, onNovo }: { relatorio: Relatorio; onNovo: () => void }) {
  return (
    <div className="space-y-6">
      {relatorio.interrompido ? (
        <p role="alert" className="text-sm text-danger">
          Import interrompido por um erro no servidor (ref: <span className="font-mono">{relatorio.interrompido.ref}</span>):{" "}
          <span className="font-mono">{relatorio.interrompido.naoProcessados}</span> cards não foram processados. O que aparece abaixo foi gravado; envie o
          arquivo de novo para terminar — reimportar não duplica.
        </p>
      ) : (
        <p role="status" className="text-sm text-success">
          Import concluído.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Numero rotulo="criados" valor={relatorio.criados} tom="success" />
        <Numero rotulo="atualizados" valor={relatorio.atualizados} />
        <Numero rotulo="sem mudança" valor={relatorio.semMudanca} />
        <Numero rotulo="foram para Projetos" valor={relatorio.projetosCriados} />
        <Numero rotulo="linhas repetidas" valor={relatorio.duplicadas} tom={relatorio.duplicadas ? "warn" : undefined} />
        <Numero rotulo="pulados" valor={relatorio.pulados} tom={relatorio.pulados ? "danger" : undefined} />
      </div>
      <ListaOcorrencias titulo="Erros por linha" itens={relatorio.erros} tom="danger" />
      <ListaOcorrencias titulo="Avisos" itens={relatorio.avisos} tom="warn" />
      <div className="flex flex-wrap gap-3">
        {relatorio.erros.length + relatorio.avisos.length > 0 ? (
          <Button type="button" variant="outline" onClick={() => baixarCsv("import-pipefy-erros.csv", relatorio.erros, relatorio.avisos)}>
            Baixar erros (CSV)
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onNovo}>
          Importar outro arquivo
        </Button>
      </div>
    </div>
  );
}
