"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";

/**
 * Restaurar da lixeira. `opcoesFase` não vazio = a fase original do card foi
 * arquivada: pede a fase de destino (o servidor recusa sem ela).
 */
export function Restaurar({
  acao,
  opcoesFase = [],
}: {
  acao: (faseId: string | null) => Promise<RespostaAcao>;
  opcoesFase?: { id: string; nome: string }[];
}) {
  const idSelect = useId();
  const router = useRouter();
  const [faseId, setFaseId] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const precisaFase = opcoesFase.length > 0;

  function restaurar() {
    startTransition(async () => {
      const falha = await executarAcao(() => acao(precisaFase ? faseId || null : null), "restaurar");
      setErro(falha);
      if (!falha) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {precisaFase ? (
          <>
            <label htmlFor={idSelect} className="sr-only">
              Fase de destino
            </label>
            <select
              id={idSelect}
              value={faseId}
              onChange={(e) => setFaseId(e.target.value)}
              className="h-7 rounded-lg border border-input bg-input/30 px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">voltar para…</option>
              {opcoesFase.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={restaurar}>
          <ArchiveRestore aria-hidden /> Restaurar
        </Button>
      </div>
      <MensagemErro falha={erro} className="max-w-xs text-right" />
    </div>
  );
}
