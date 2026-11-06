"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { executarAcao, type FalhaUI, type RespostaAcao } from "@/lib/erros/cliente";

/** Roda uma server action com pendente, erro na tela e refresh no sucesso. */
export function useAcao() {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  function rodar<R extends RespostaAcao>(chamar: () => Promise<R>, acao: string, depois?: (r: R) => void) {
    startTransition(async () => {
      let resposta: R | undefined;
      const f = await executarAcao(async () => (resposta = await chamar()), acao);
      setErro(f);
      if (!f) {
        depois?.(resposta as R);
        router.refresh();
      }
    });
  }
  return { pendente, erro, setErro, rodar };
}
