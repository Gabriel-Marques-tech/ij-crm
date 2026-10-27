import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AvisoSemCredito } from "@/components/shell/aviso-sem-credito";
import { exigirUsuario } from "@/lib/auth/atual";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { estadoSemCredito } from "@/lib/llm/alerta-credito";
import { resolverInicio } from "@/lib/preferencias/inicio";
import { obterPreferencias } from "@/lib/preferencias/servico";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const usuario = await exigirUsuario();
  // GAB-46: só gestor/admin vê; estadoSemCredito nunca lança (erro vira log com ref e sem banner).
  // resolverInicio também nunca lança (banco fora → Minha Semana). Em paralelo: uma ida ao banco a menos no TTFB.
  const [semCredito, inicio] = await Promise.all([
    temPapelMinimo(usuario.papel, "GESTOR") ? estadoSemCredito() : null,
    resolverInicio(() => obterPreferencias(usuario.id)),
  ]);
  return (
    <AppShell usuario={usuario} inicio={inicio}>
      {semCredito && <AvisoSemCredito desde={semCredito.desde} ultimoErro={semCredito.ultimoErro} />}
      {children}
    </AppShell>
  );
}
