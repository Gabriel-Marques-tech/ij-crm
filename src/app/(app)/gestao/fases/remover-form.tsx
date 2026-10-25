"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FaseComUso } from "@/lib/fases/fases";
import { removerFaseAction, type EstadoRemocao } from "./actions";

const SELECT_CLASSE =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Remoção de fase. Com cards: pede destino (`destinos` já vem só com fases do
 * mesmo tipo terminal, ver `destinoCompativel`), migra e arquiva. Só com histórico:
 * arquiva. Sem nada: exclui de vez. A decisão final é do serviço; aqui só se
 * explica o que vai acontecer.
 */
export function RemoverForm({ fase, destinos, onFeito }: { fase: FaseComUso; destinos: FaseComUso[]; onFeito: () => void }) {
  const [estado, action, pendente] = useActionState(async (prev: EstadoRemocao, form: FormData) => {
    const r = await removerFaseAction(prev, form);
    if (r?.acao) onFeito();
    return r;
  }, undefined);

  const temCards = fase.uso.cards > 0;
  const temHistorico = fase.uso.transicoes > 0;
  const vaiArquivar = temCards || temHistorico;
  const semDestino = temCards && destinos.length === 0;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="faseId" value={fase.id} />

      {temCards ? (
        <div className="space-y-1.5">
          <Label htmlFor="destinoFaseId">
            {fase.uso.cards === 1 ? "Há 1 card nesta fase. Para onde ele vai?" : `Há ${fase.uso.cards} cards nesta fase. Para onde eles vão?`}
          </Label>
          <select id="destinoFaseId" name="destinoFaseId" required defaultValue="" className={SELECT_CLASSE} disabled={semDestino}>
            <option value="" disabled>
              {semDestino ? "Nenhuma fase do mesmo tipo disponível" : "Escolha a fase de destino"}
            </option>
            {destinos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg-faint">
            {semDestino
              ? "Cards só migram para uma fase do mesmo tipo (aberta → aberta, ganho → ganho, perdido → perdido). Mova esses cards pelo Kanban — fases de ganho/perdido exigem os dados do fechamento."
              : "A mudança fica registrada no histórico de cada card (origem: sistema) e o tempo na fase recomeça. Só aparecem fases do mesmo tipo (aberta, ganho ou perdido)."}
          </p>
        </div>
      ) : null}

      <p className="text-sm text-fg-soft">
        {vaiArquivar
          ? "Como a fase fica no histórico de movimentações, ela será arquivada: some do Kanban e da criação de cards, mas nada se perde. Dá para restaurar depois."
          : "Esta fase não tem cards nem histórico: será excluída de vez."}
      </p>

      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" className="w-full" disabled={pendente || semDestino}>
        {pendente ? "Removendo…" : temCards ? "Mover cards e arquivar" : vaiArquivar ? "Arquivar fase" : "Excluir fase"}
      </Button>
    </form>
  );
}
