"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Quadro (vendas/projetos) que a página atual declara para a navegação. A lista
 * do Kanban usa o `?quadro=`; o detalhe do card (`/projetos/[id]`) não tem esse
 * parâmetro — links de Minha Semana, Empresas etc. não o levam — então a página
 * declara o quadro do próprio card com `<MarcarQuadroAtivo>`.
 */
const Ctx = createContext<{ quadro: string | null; definir: (q: string | null) => void }>({ quadro: null, definir: () => {} });

export function QuadroAtivoProvider({ children }: { children: ReactNode }) {
  const [quadro, definir] = useState<string | null>(null);
  return <Ctx.Provider value={{ quadro, definir }}>{children}</Ctx.Provider>;
}

export function useQuadroAtivo(): string | null {
  return useContext(Ctx).quadro;
}

/** Declara o quadro enquanto a página está montada (limpa ao sair). */
export function MarcarQuadroAtivo({ quadro }: { quadro: string }) {
  const { definir } = useContext(Ctx);
  useEffect(() => {
    definir(quadro);
    return () => definir(null);
  }, [quadro, definir]);
  return null;
}
