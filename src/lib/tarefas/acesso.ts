import "server-only";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/atual";
import { podeVerTarefas } from "@/lib/auth/areas";
import type { UsuarioSessao } from "@/lib/auth/sessao";

/**
 * Toda página e toda server action do kanban interno chama isto. `exigirEscrita`
 * não basta: deixa passar vendedor. Quem não passa em `podeVerTarefas` → /403,
 * mesmo chamando a action direto. A sessão já traz `area` e `cargos`.
 */
export async function exigirTarefas(): Promise<UsuarioSessao> {
  const u = await exigirUsuario();
  if (!podeVerTarefas(u)) redirect("/403");
  return u;
}
