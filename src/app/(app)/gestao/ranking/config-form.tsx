"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CONFIG_RANKING_PADRAO, type ConfigRanking } from "@/lib/ranking/config";
import { salvarConfigRankingAction } from "./actions";

type Campo = { nome: keyof ConfigRanking["pesos"] | keyof ConfigRanking["minimos"]; grupo: "pesos" | "minimos"; rotulo: string; ajuda: string };

const CAMPOS: Campo[] = [
  { nome: "ganho", grupo: "pesos", rotulo: "Venda ganha", ajuda: "Pontos por venda em ganho com data de ganho no período (para o responsável)." },
  { nome: "bonusPorMil", grupo: "pesos", rotulo: "Bônus por R$ 1.000", ajuda: "Pontos a cada R$ 1.000 completos de valor fechado." },
  { nome: "tetoBonus", grupo: "pesos", rotulo: "Teto do bônus", ajuda: "Máximo de pontos de bônus por venda." },
  { nome: "avanco", grupo: "pesos", rotulo: "Avanço de fase", ajuda: "Primeira entrada do card numa fase aberta mais adiante (para quem moveu)." },
  { nome: "acaoFeita", grupo: "pesos", rotulo: "Próxima ação feita", ajuda: "\"Marcar feita\" da Minha Semana, por ação que conta." },
  { nome: "acoesPorDia", grupo: "pesos", rotulo: "Ações feitas por dia", ajuda: "Máximo de ações feitas que pontuam por vendedor por dia (0 = não pontua)." },
  { nome: "cardCriado", grupo: "pesos", rotulo: "Card criado", ajuda: "Card novo em Vendas (UI ou WhatsApp), para quem criou." },
  { nome: "fechadosConversao", grupo: "minimos", rotulo: "Mín. de fechadas (conversão)", ajuda: "Vendas ganhas + perdidas para concorrer a melhor conversão." },
  { nome: "ganhosTempo", grupo: "minimos", rotulo: "Mín. de ganhos (mais rápido)", ajuda: "Ganhos no período para concorrer a fechamento mais rápido." },
];

function valoresDe(c: ConfigRanking): Record<string, string> {
  return Object.fromEntries(CAMPOS.map((f) => [f.nome, String((c[f.grupo] as Record<string, number>)[f.nome])]));
}

export function ConfigRankingForm({ atual }: { atual: ConfigRanking }) {
  const [estado, action, pendente] = useActionState(salvarConfigRankingAction, undefined);
  const [valores, setValores] = useState(() => valoresDe(atual));
  const [mostrar, setMostrar] = useState(atual.mostrarAosVendedores);

  return (
    <form action={action} className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="mostrar">Mostrar ranking aos vendedores</Label>
            <p className="mt-1 text-sm text-fg-mute">Desligado: cada vendedor vê só os próprios pontos e métricas. Gestor e admin sempre veem tudo.</p>
          </div>
          <Switch id="mostrar" checked={mostrar} onCheckedChange={(v) => setMostrar(v)} />
          {mostrar ? <input type="hidden" name="mostrarAosVendedores" value="on" /> : null}
        </div>
      </section>

      {(["pesos", "minimos"] as const).map((grupo) => (
        <section key={grupo} className="rounded-xl border border-border bg-surface p-5">
          <p className="eyebrow mb-4">{grupo === "pesos" ? "pesos (pontos)" : "mínimos dos destaques"}</p>
          <div className="grid gap-5 sm:grid-cols-2">
            {CAMPOS.filter((f) => f.grupo === grupo).map((f) => (
              <div key={f.nome} className="space-y-1.5">
                <Label htmlFor={f.nome}>{f.rotulo}</Label>
                <Input
                  id={f.nome}
                  name={f.nome}
                  type="number"
                  inputMode="numeric"
                  min={grupo === "minimos" ? 1 : 0}
                  step={1}
                  required
                  value={valores[f.nome]}
                  onChange={(e) => setValores((v) => ({ ...v, [f.nome]: e.target.value }))}
                  className="font-mono tabular"
                />
                <p className="text-xs text-fg-faint">
                  {f.ajuda} <span className="font-mono">Padrão: {(CONFIG_RANKING_PADRAO[grupo] as Record<string, number>)[f.nome]}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}

      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      {estado?.ok ? <p className="text-sm text-success">Salvo. O ranking já usa os novos valores.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : "Salvar"}
        </Button>
        <Button type="button" variant="outline" disabled={pendente} onClick={() => setValores(valoresDe(CONFIG_RANKING_PADRAO))}>
          Restaurar padrão
        </Button>
      </div>
      <p className="text-xs text-fg-faint">&quot;Restaurar padrão&quot; preenche os pesos e mínimos padrão; nada muda até salvar. A visibilidade não é alterada.</p>
    </form>
  );
}
