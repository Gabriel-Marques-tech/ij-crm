import type { ReactNode } from "react";
import type { UsuarioSessao } from "@/lib/auth/sessao";
import { QuadroAtivoProvider } from "./quadro-ativo";
import { Rail } from "./rail";
import { Topbar } from "./topbar";

/**
 * `inicio` = destino já resolvido da página inicial (preferência do usuário).
 * O logo aponta direto para ele, sem passar pelo redirect de "/".
 */
export function AppShell({ children, usuario, inicio }: { children: ReactNode; usuario: UsuarioSessao; inicio: string }) {
  return (
    <QuadroAtivoProvider>
      <div className="flex min-h-screen">
        <Rail papel={usuario.papel} inicio={inicio} />
        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-[88px]">
          <Topbar usuario={usuario} inicio={inicio} />
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </QuadroAtivoProvider>
  );
}
