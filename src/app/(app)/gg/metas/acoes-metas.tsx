"use client";

import { useState } from "react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import type { Opcao } from "@/components/gg/acoes-ocupacao";
import { CAMPO } from "@/components/gg/ui";
import { useAcao } from "@/components/gg/use-acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { atualizarResultadoAction, concluirIniciativaAction, criarCicloAction, criarIniciativaAction, criarKpiAction, criarObjetivoAction, criarResultadoAction, registrarMedicaoAction } from "../actions";

const Campo = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <label className="grid gap-1.5 text-xs text-fg-mute">
    {rotulo}
    {children}
  </label>
);
const Sel = ({ nome, opcoes, vazio }: { nome: string; opcoes: Opcao[]; vazio?: string }) => (
  <select name={nome} required={!vazio} className={CAMPO}>
    {vazio ? <option value="">{vazio}</option> : null}
    {opcoes.map((o) => (
      <option key={o.id} value={o.id}>
        {o.nome}
      </option>
    ))}
  </select>
);

/** "Novo …" da aba aberta: ciclo, objetivo + KR, KPI ou iniciativa. */
export function NovaMeta({ aba, ciclos, objetivos, kpis, membros, fontes }: { aba: string; ciclos: Opcao[]; objetivos: Opcao[]; kpis: Opcao[]; membros: Opcao[]; fontes: Opcao[] }) {
  const [aberto, setAberto] = useState<null | "ciclo" | "objetivo" | "kr" | "kpi" | "iniciativa">(null);
  const { pendente, erro, rodar } = useAcao();
  const fechar = () => setAberto(null);
  const s = (f: FormData, k: string) => String(f.get(k) ?? "");
  const botoes: [typeof aberto, string][] =
    aba === "ciclos" ? [["ciclo", "Novo ciclo"]] : aba === "kpis" ? [["kpi", "Novo KPI"]] : aba === "iniciativas" ? [["iniciativa", "Nova iniciativa"]] : [["objetivo", "Novo objetivo"], ["kr", "Novo resultado-chave"]];
  return (
    <span className="ml-auto flex gap-2">
      {botoes.map(([k, n]) => (
        <Button key={k} variant={k === "kr" ? "outline" : "default"} onClick={() => setAberto(k)} disabled={(k === "objetivo" && !ciclos.length) || (k === "kr" && !objetivos.length)} title={k === "objetivo" && !ciclos.length ? "Crie um ciclo antes (aba Ciclos)." : k === "kr" && !objetivos.length ? "Crie um objetivo antes." : undefined}>
          {n}
        </Button>
      ))}
      <Dialog open={aberto !== null} onOpenChange={(a) => !a && fechar()}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const fonte = s(f, "fonte") || null;
              const chamar =
                aberto === "ciclo"
                  ? () => criarCicloAction(s(f, "nome"), s(f, "inicio"), s(f, "fim"))
                  : aberto === "objetivo"
                    ? () => criarObjetivoAction(s(f, "titulo"), s(f, "cicloId"), s(f, "responsavelId"))
                    : aberto === "kr"
                      ? () => criarResultadoAction({ objetivoId: s(f, "objetivoId"), titulo: s(f, "titulo"), unidade: s(f, "unidade"), inicial: Number(s(f, "inicial")), meta: Number(s(f, "meta")), fonte })
                      : aberto === "kpi"
                        ? () => criarKpiAction({ titulo: s(f, "titulo"), unidade: s(f, "unidade"), meta: Number(s(f, "meta")), direcao: s(f, "direcao"), fonte })
                        : () => criarIniciativaAction({ titulo: s(f, "titulo"), objetivoId: s(f, "objetivoId") || null, kpiId: s(f, "kpiId") || null, responsavelId: s(f, "responsavelId"), prazo: s(f, "prazo") || null });
              rodar(chamar, "salvar", fechar);
            }}
          >
            <DialogHeader>
              <DialogTitle>{botoes.find(([k]) => k === aberto)?.[1]}</DialogTitle>
            </DialogHeader>
            {aberto === "ciclo" ? (
              <>
                <Campo rotulo="Nome do ciclo">
                  <input name="nome" required maxLength={60} placeholder="2026.2" className={CAMPO} />
                </Campo>
                <Campo rotulo="Início">
                  <input name="inicio" type="date" required className={CAMPO} />
                </Campo>
                <Campo rotulo="Fim">
                  <input name="fim" type="date" required className={CAMPO} />
                </Campo>
              </>
            ) : aberto === "objetivo" ? (
              <>
                <Campo rotulo="Título">
                  <input name="titulo" required maxLength={200} placeholder="Fortalecer a experiência dos membros" className={CAMPO} />
                </Campo>
                <Campo rotulo="Ciclo">
                  <Sel nome="cicloId" opcoes={ciclos} />
                </Campo>
                <Campo rotulo="Responsável">
                  <Sel nome="responsavelId" opcoes={membros} />
                </Campo>
              </>
            ) : aberto === "kr" || aberto === "kpi" ? (
              <>
                {aberto === "kr" ? (
                  <Campo rotulo="Objetivo">
                    <Sel nome="objetivoId" opcoes={objetivos} />
                  </Campo>
                ) : null}
                <Campo rotulo="Título">
                  <input name="titulo" required maxLength={200} className={CAMPO} />
                </Campo>
                <Campo rotulo="Unidade (%, membros, R$ mil…)">
                  <input name="unidade" maxLength={30} required={aberto === "kpi"} className={CAMPO} />
                </Campo>
                {aberto === "kr" ? (
                  <Campo rotulo="Valor inicial">
                    <input name="inicial" type="number" step="any" required className={CAMPO} />
                  </Campo>
                ) : (
                  <Campo rotulo="Direção desejada">
                    <select name="direcao" className={CAMPO}>
                      <option value="MAIOR">Quanto maior, melhor</option>
                      <option value="MENOR">Quanto menor, melhor</option>
                    </select>
                  </Campo>
                )}
                <Campo rotulo="Meta">
                  <input name="meta" type="number" step="any" required className={CAMPO} />
                </Campo>
                <Campo rotulo="Fonte (vazio = medição manual)">
                  <Sel nome="fonte" opcoes={fontes} vazio="Manual" />
                </Campo>
              </>
            ) : aberto === "iniciativa" ? (
              <>
                <Campo rotulo="Título">
                  <input name="titulo" required maxLength={200} className={CAMPO} />
                </Campo>
                <Campo rotulo="Objetivo (opcional)">
                  <Sel nome="objetivoId" opcoes={objetivos} vazio="—" />
                </Campo>
                <Campo rotulo="KPI (opcional)">
                  <Sel nome="kpiId" opcoes={kpis} vazio="—" />
                </Campo>
                <Campo rotulo="Responsável">
                  <Sel nome="responsavelId" opcoes={membros} />
                </Campo>
                <Campo rotulo="Prazo (opcional)">
                  <input name="prazo" type="date" className={CAMPO} />
                </Campo>
              </>
            ) : null}
            <MensagemErro falha={erro} className="text-sm" />
            <Button type="submit" disabled={pendente}>
              Salvar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}

export function Medir({ kpiId, hoje }: { kpiId: string; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  const { pendente, erro, rodar } = useAcao();
  return aberto ? (
    <form
      className="inline-flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        rodar(() => registrarMedicaoAction(kpiId, String(f.get("data")), Number(f.get("valor"))), "registrar a medição", () => setAberto(false));
      }}
    >
      <input name="data" type="date" defaultValue={hoje} max={hoje} aria-label="Data da medição" className={`${CAMPO} w-36`} />
      <input name="valor" type="number" step="any" required aria-label="Valor" className={`${CAMPO} w-24`} />
      <Button size="sm" type="submit" disabled={pendente}>
        Salvar
      </Button>
      <MensagemErro falha={erro} className="text-xs" />
    </form>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
      Registrar medição
    </Button>
  );
}

export function AtualizarKr({ id, atual }: { id: string; atual: number }) {
  const [v, setV] = useState(String(atual));
  const { pendente, erro, rodar } = useAcao();
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" step="any" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== atual && rodar(() => atualizarResultadoAction(id, Number(v)), "atualizar o valor")} disabled={pendente} aria-label="Valor atual" className={`${CAMPO} w-20 font-mono`} />
      <MensagemErro falha={erro} className="text-xs" />
    </span>
  );
}

export function ConcluirIniciativa({ id, concluida }: { id: string; concluida: boolean }) {
  const { pendente, erro, rodar } = useAcao();
  return (
    <span className="inline-flex items-center gap-1.5">
      <MensagemErro falha={erro} className="text-xs" />
      <Button size="sm" variant={concluida ? "ghost" : "outline"} disabled={pendente} onClick={() => rodar(() => concluirIniciativaAction(id, !concluida), "atualizar a iniciativa")}>
        {concluida ? "Reabrir" : "Concluir"}
      </Button>
    </span>
  );
}
