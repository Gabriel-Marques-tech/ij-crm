"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { fmtDias, fmtDinheiro, fmtInteiro, fmtPercentual } from "@/lib/ranking/formatar";

export type LinhaMetricas = {
  id: string;
  nome: string;
  fotoEm: number | null;
  pontos: number;
  ganhos: number;
  perdidos: number;
  conversao: number | null;
  fechado: number;
  ticketMedio: number | null;
  tempoMedioGanhoDias: number | null;
  avancos: number;
  acoesFeitas: number;
  abertos: number;
  emAberto: number;
};

type Coluna = keyof Omit<LinhaMetricas, "id" | "fotoEm">;

const COLUNAS: { chave: Coluna; rotulo: string; titulo?: string; fmt: (l: LinhaMetricas) => string; numerica: boolean }[] = [
  { chave: "nome", rotulo: "Vendedor", fmt: (l) => l.nome, numerica: false },
  { chave: "pontos", rotulo: "Pontos", fmt: (l) => fmtInteiro(l.pontos), numerica: true },
  { chave: "ganhos", rotulo: "Ganhos", fmt: (l) => fmtInteiro(l.ganhos), numerica: true },
  { chave: "perdidos", rotulo: "Perdidos", fmt: (l) => fmtInteiro(l.perdidos), numerica: true },
  { chave: "conversao", rotulo: "Conversão", titulo: "ganhos ÷ (ganhos + perdidos)", fmt: (l) => fmtPercentual(l.conversao), numerica: true },
  { chave: "fechado", rotulo: "R$ fechado", fmt: (l) => fmtDinheiro(l.fechado), numerica: true },
  { chave: "ticketMedio", rotulo: "Ticket médio", titulo: "R$ fechado ÷ ganhos com valor", fmt: (l) => fmtDinheiro(l.ticketMedio), numerica: true },
  { chave: "tempoMedioGanhoDias", rotulo: "Até ganho", titulo: "tempo médio da criação do card ao ganho", fmt: (l) => fmtDias(l.tempoMedioGanhoDias), numerica: true },
  { chave: "avancos", rotulo: "Avanços", fmt: (l) => fmtInteiro(l.avancos), numerica: true },
  { chave: "acoesFeitas", rotulo: "Ações feitas", fmt: (l) => fmtInteiro(l.acoesFeitas), numerica: true },
  { chave: "abertos", rotulo: "Abertos hoje", titulo: "cards abertos em Vendas agora", fmt: (l) => fmtInteiro(l.abertos), numerica: true },
  { chave: "emAberto", rotulo: "R$ em aberto", titulo: "soma do orçamento previsto dos cards abertos", fmt: (l) => fmtDinheiro(l.emAberto), numerica: true },
];

/** "Métricas por vendedor" (ordenável no cliente; ≤ 15 linhas). `time` = linha de total/média, sempre por último. */
export function TabelaMetricas({ linhas, time, euId }: { linhas: LinhaMetricas[]; time: LinhaMetricas | null; euId: string }) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: "pontos", desc: true });
  const ordenadas = useMemo(() => {
    const v = (l: LinhaMetricas) => l[ordem.col];
    return [...linhas].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      // "—" (null) sempre no fim, em qualquer direção.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const c = typeof x === "string" ? x.localeCompare(y as string, "pt-BR") : (x as number) - (y as number);
      return ordem.desc ? -c : c;
    });
  }, [linhas, ordem]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[60rem] text-sm">
        <thead>
          <tr className="border-b border-border">
            {COLUNAS.map((c) => {
              const ativa = ordem.col === c.chave;
              return (
                <th key={c.chave} scope="col" aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : "none"} className={cn("px-3 py-2 font-normal", c.numerica ? "text-right" : "text-left")}>
                  <button
                    type="button"
                    title={c.titulo}
                    onClick={() => setOrdem((o) => ({ col: c.chave, desc: o.col === c.chave ? !o.desc : c.numerica }))}
                    className={cn("eyebrow inline-flex items-center gap-1 hover:text-foreground", ativa && "text-foreground")}
                  >
                    {c.rotulo}
                    {ativa ? ordem.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l) => (
            <tr key={l.id} className={cn("border-b border-border last:border-b-0", l.id === euId && "bg-primary-soft/40")}>
              {COLUNAS.map((c) =>
                c.chave === "nome" ? (
                  <th key={c.chave} scope="row" className="px-3 py-2 text-left font-medium">
                    <span className="flex items-center gap-2">
                      <Avatar nome={l.nome} usuarioId={l.id} fotoEm={l.fotoEm} tamanho="xs" />
                      <span className="truncate">{l.nome}</span>
                    </span>
                  </th>
                ) : (
                  <td key={c.chave} className="px-3 py-2 text-right font-mono tabular text-fg-soft">
                    {c.fmt(l)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {time ? (
          <tfoot>
            <tr className="border-t border-border-strong bg-surface-strong/50">
              {COLUNAS.map((c) =>
                c.chave === "nome" ? (
                  <th key={c.chave} scope="row" className="px-3 py-2 text-left font-medium">
                    Time <span className="font-normal text-fg-mute">(total · médias do time)</span>
                  </th>
                ) : (
                  <td key={c.chave} className="px-3 py-2 text-right font-mono font-semibold tabular">
                    {c.fmt(time)}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
