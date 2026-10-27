import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AvisoSemCredito } from "@/components/shell/aviso-sem-credito";
import { exigirUsuario } from "@/lib/auth/atual";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { estadoSemCredito } from "@/lib/llm/alerta-credito";
import { destinoInicio } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const usuario = await exigirUsuario();
  // GAB-46: só gestor/admin vê; estadoSemCredito nunca lança (erro vira log com ref e sem banner).
  const semCredito = temPapelMinimo(usuario.papel, "GESTOR") ? await estadoSemCredito() : null;
  const inicio = destinoInicio(await obterPreferencias(usuario.id));
  return (
    <AppShell usuario={usuario} inicio={inicio}>
      {semCredito && <AvisoSemCredito desde={semCredito.desde} ultimoErro={semCredito.ultimoErro} />}
      {children}
    </AppShell>
  );
}
