import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/atual";
import { destinoInicio } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";

/**
 * `/` → página inicial escolhida em Meu perfil (GAB-43): Minha Semana (padrão),
 * Kanban Vendas ou Kanban Projetos. Redirect no servidor (sem flash). Destino
 * sai de uma lista fixa; `?vendedor=` de links antigos segue para a semana.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ vendedor?: string | string[] }> }) {
  const eu = await exigirUsuario();
  const { vendedor } = await searchParams;
  if (typeof vendedor === "string" && vendedor) redirect(`/semana?vendedor=${encodeURIComponent(vendedor)}`);
  redirect(destinoInicio(await obterPreferencias(eu.id)));
}
