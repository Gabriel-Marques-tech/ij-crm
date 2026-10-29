"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Sessão é VISUALIZADOR (somente leitura)? Decidido no servidor (layout de
 * `(app)`, pelo papel da sessão) e lido pelos componentes cliente para
 * esconder "+", arrasto, "marcar feita" etc. É só UI: toda action de escrita
 * recusa no servidor (`exigirEscrita`) de qualquer jeito.
 */
const Ctx = createContext(false);

export function SomenteLeituraProvider({ valor, children }: { valor: boolean; children: ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSomenteLeitura(): boolean {
  return useContext(Ctx);
}
