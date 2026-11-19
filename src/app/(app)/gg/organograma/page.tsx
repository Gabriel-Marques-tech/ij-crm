import { redirect } from "next/navigation";
import { destinoAntigo } from "@/lib/gg/membros";

/** GAB-106: o organograma foi para `/membros` (visão organograma), levando os galhos recolhidos. */
export default async function OrganogramaAntigo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(destinoAntigo("organograma", await searchParams));
}
