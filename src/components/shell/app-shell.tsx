import type { ReactNode } from "react";
import type { UsuarioSessao } from "@/lib/auth/sessao";
import { Rail } from "./rail";
import { Topbar } from "./topbar";

export function AppShell({ children, usuario }: { children: ReactNode; usuario: UsuarioSessao }) {
  return (
    <div className="flex min-h-screen">
      <Rail papel={usuario.papel} />
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-[88px]">
        <Topbar usuario={usuario} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
