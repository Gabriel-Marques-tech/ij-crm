"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfigTecnica, ConfigTecnicaEfetiva, Origem } from "@/lib/config/tecnica";
import type { GrupoEvolution } from "@/lib/whatsapp/evolution-admin";
import { listarGruposAction, restaurarConfigTecnicaAction, salvarConfigTecnicaAction } from "./actions";

const ORIGEM: Record<Origem, string> = { config: "salvo aqui", env: "do ambiente", padrao: "padrão" };

function Herdado({ v }: { v: { valor: string | number | null; origem: Origem } }) {
  return (
    <span className="font-mono">
      Vazio = {v.valor === null || v.valor === "" ? "(nenhum)" : String(v.valor)} ({ORIGEM[v.origem]})
    </span>
  );
}

const CLASSE_SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Campos vazios herdam do ambiente (ou do padrão) — o texto de ajuda mostra o
 * que valeria. `versao` vai no submit para a gravação condicional; os campos
 * remontam quando ela muda.
 */
export function ConfigTecnicaForm({
  atual,
  herdado,
  efetivo,
  versao,
}: {
  atual: ConfigTecnica;
  herdado: ConfigTecnicaEfetiva;
  efetivo: ConfigTecnicaEfetiva;
  versao: number | null;
}) {
  const [estado, salvar, salvando] = useActionState(salvarConfigTecnicaAction, undefined);
  const [estadoR, restaurar, restaurando] = useActionState(restaurarConfigTecnicaAction, undefined);
  const erro = estado?.erro ?? estadoR?.erro;
  return (
    <div className="space-y-4">
      <form action={salvar} className="space-y-4">
        <input type="hidden" name="versao" value={versao ?? ""} />
        <Campos key={versao ?? "padrao"} atual={atual} herdado={herdado} efetivo={efetivo} />
        {erro ? (
          <p role="alert" className="text-sm text-danger">
            {erro}
          </p>
        ) : null}
        {estado?.ok ? <p className="text-sm text-success">Salvo. Vale a partir da próxima mensagem.</p> : null}
        {estadoR?.ok ? <p className="text-sm text-success">Restaurado: tudo volta a vir do ambiente.</p> : null}
        <Button type="submit" disabled={salvando || restaurando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </form>
      <form action={restaurar}>
        <Button type="submit" variant="outline" size="sm" disabled={salvando || restaurando || versao === null}>
          {restaurando ? "Restaurando…" : "Apagar o que foi salvo aqui (usar só o ambiente)"}
        </Button>
      </form>
    </div>
  );
}

function Campos({ atual, herdado, efetivo }: { atual: ConfigTecnica; herdado: ConfigTecnicaEfetiva; efetivo: ConfigTecnicaEfetiva }) {
  const [grupo, setGrupo] = useState(atual.grupoJid ?? "");
  const [grupos, setGrupos] = useState<GrupoEvolution[] | null>(null);
  const [erroGrupos, setErroGrupos] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();
  const num = (v: number | undefined) => (v === undefined ? "" : String(v));

  function buscarGrupos() {
    setErroGrupos(null);
    iniciar(async () => {
      const r = await listarGruposAction();
      if (r.ok) setGrupos(r.grupos);
      else setErroGrupos(r.erro);
    });
  }

  return (
    <>
      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="eyebrow mb-4">grupo do whatsapp</p>
        <div className="space-y-1.5">
          <Label htmlFor="grupoJid">JID do grupo (GRUPO_JID)</Label>
          <div className="flex gap-2">
            <Input id="grupoJid" name="grupoJid" value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="1203630…@g.us" className="font-mono" />
            <Button type="button" variant="outline" disabled={buscando} onClick={buscarGrupos}>
              {buscando ? "Buscando…" : "Listar grupos"}
            </Button>
          </div>
          <p className="text-xs text-fg-faint">
            Só mensagens deste grupo entram no CRM. <Herdado v={herdado.grupoJid} />
          </p>
          {erroGrupos ? (
            <p role="alert" className="text-sm text-danger">
              {erroGrupos}
            </p>
          ) : null}
          {grupos ? (
            grupos.length === 0 ? (
              <p className="text-sm text-fg-mute">A instância não está em nenhum grupo.</p>
            ) : (
              <ul className="mt-2 max-h-64 divide-y divide-border overflow-auto rounded-lg border border-border">
                {grupos.map((g) => (
                  <li key={g.jid}>
                    <button
                      type="button"
                      onClick={() => setGrupo(g.jid)}
                      aria-pressed={grupo === g.jid}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-hover ${grupo === g.jid ? "text-primary" : ""}`}
                    >
                      <span>{g.nome}</span>
                      <span className="font-mono text-xs text-fg-mute">
                        {g.membros === null ? "" : `${g.membros} membros · `}
                        {g.jid}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="eyebrow mb-4">llm</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="provedor">Provedor (extração e classificação)</Label>
            <select id="provedor" name="provedor" defaultValue={atual.provedor ?? ""} className={CLASSE_SELECT}>
              <option value="">Herdar ({String(herdado.provedor.valor)}, {ORIGEM[herdado.provedor.origem]})</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="mock">mock (só dev; recusado em produção)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modeloExtracao">Modelo de extração</Label>
            <Input id="modeloExtracao" name="modeloExtracao" defaultValue={atual.modeloExtracao ?? ""} className="font-mono" />
            <p className="text-xs text-fg-faint">
              <Herdado v={efetivo.modeloExtracao.origem === "config" ? herdado.modeloExtracao : efetivo.modeloExtracao} />. Precisa ser do provedor (Anthropic: <span className="font-mono">claude-…</span>).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="modeloClassificacao">Modelo de classificação (sem #crm)</Label>
            <Input id="modeloClassificacao" name="modeloClassificacao" defaultValue={atual.modeloClassificacao ?? ""} className="font-mono" />
            <p className="text-xs text-fg-faint">Vazio = o do ambiente, ou o mesmo da extração.</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="eyebrow mb-4">limiares de confiança (0 a 1)</p>
        <div className="grid gap-5 sm:grid-cols-3">
          {(
            [
              ["limiarConfianca", "Com #crm", "Abaixo disto o card nasce marcado para revisar."],
              ["limiarSemTag", "Sem #crm", "Mensagem sem tag só age com confiança ≥ isto. Precisa ser ≥ o de com #crm."],
              ["limiarClassificador", "Classificador", "Mensagem sem tag com relevância abaixo disto é descartada."],
            ] as const
          ).map(([nome, rotulo, ajuda]) => (
            <div key={nome} className="space-y-1.5">
              <Label htmlFor={nome}>{rotulo}</Label>
              <Input id={nome} name={nome} inputMode="decimal" defaultValue={num(atual[nome])} className="font-mono tabular" />
              <p className="text-xs text-fg-faint">
                {ajuda} <Herdado v={herdado[nome]} />
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="eyebrow mb-4">envio</p>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="timeoutEnvioS">Timeout de envio à Evolution (segundos)</Label>
          <Input
            id="timeoutEnvioS"
            name="timeoutEnvioS"
            type="number"
            min={5}
            max={120}
            step={1}
            defaultValue={atual.timeoutEnvioMs === undefined ? "" : String(atual.timeoutEnvioMs / 1000)}
            className="font-mono tabular"
          />
          <p className="text-xs text-fg-faint">
            5 a 120 s. <span className="font-mono">Vazio = {herdado.timeoutEnvioMs.valor / 1000} s ({ORIGEM[herdado.timeoutEnvioMs.origem]})</span>
          </p>
        </div>
      </section>
    </>
  );
}
