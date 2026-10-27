import type { LinhaPropria } from "@/lib/ranking/servico";
import type { PesosRanking } from "@/lib/ranking/config";
import { fmtInteiro } from "@/lib/ranking/formatar";

/** Detalhamento dos pontos do usuário no período, com a regra de cada categoria. */
export function MeusPontos({ eu, pesos, posicao }: { eu: LinhaPropria | null; pesos: PesosRanking; posicao?: number }) {
  const itens = eu
    ? [
        { rotulo: "Vendas ganhas", qtd: eu.ganhos, pts: eu.detalhe.ganho, regra: `${pesos.ganho} + ${pesos.bonusPorMil}/R$ 1.000 (até +${pesos.tetoBonus})` },
        { rotulo: "Avanços de fase", qtd: eu.avancos, pts: eu.detalhe.avanco, regra: `${pesos.avanco} cada · 1ª entrada na fase` },
        { rotulo: "Próximas ações feitas", qtd: eu.acoesFeitas, pts: eu.detalhe.acaoFeita, regra: `${pesos.acaoFeita} cada · 1 por card/dia` },
        { rotulo: "Cards criados", qtd: eu.cardsCriados, pts: eu.detalhe.cardCriado, regra: `${pesos.cardCriado} cada` },
      ]
    : [];
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">seus pontos</p>
        {posicao ? <p className="font-mono text-xs text-fg-mute">{posicao}º lugar</p> : null}
      </div>
      {eu ? (
        <>
          <p className="mt-2 font-mono text-3xl font-semibold tabular">{fmtInteiro(eu.pontos)}</p>
          <ul className="mt-4 space-y-2.5">
            {itens.map((i) => (
              <li key={i.rotulo} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="text-fg-soft">{i.rotulo}</span> <span className="font-mono text-xs text-fg-mute">×{i.qtd}</span>
                  <span className="block text-xs text-fg-faint">{i.regra}</span>
                </span>
                <span className="font-mono tabular">{fmtInteiro(i.pts)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-fg-mute">Você não participa do ranking (só vendedores ativos e gestores com cards em Vendas).</p>
      )}
    </section>
  );
}
