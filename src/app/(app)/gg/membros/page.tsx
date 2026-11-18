import { redirect } from "next/navigation";
import { destinoAntigo } from "@/lib/gg/membros";

/** GAB-106: a lista de membros foi para `/membros` (visão lista), levando os filtros. */
export default async function MembrosAntigo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(destinoAntigo("lista", await searchParams));
}
