import { redirect } from "next/navigation";
import { HREF_MEMBROS } from "@/lib/gg/membros";

/** GAB-106: a ficha foi para `/membros/[id]`. */
export default async function FichaAntiga({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`${HREF_MEMBROS}/${encodeURIComponent(id)}`);
}
