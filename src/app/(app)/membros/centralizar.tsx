"use client";

import { useEffect } from "react";

/** A árvore da IJ inteira é mais larga que a tela: abre rolada para a raiz ficar no centro. */
export function CentralizarNaRaiz({ alvo }: { alvo: string }) {
  useEffect(() => {
    const el = document.getElementById(alvo);
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [alvo]);
  return null;
}
