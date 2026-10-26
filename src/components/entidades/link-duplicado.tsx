import Link from "next/link";
import type { Duplicado } from "@/lib/entidades/mensagens";

/** "abrir <dono> →" do identificador repetido — só quando o dono está vivo (excluído não tem página). */
export function LinkDuplicado({ duplicado }: { duplicado: Duplicado | null }) {
  if (!duplicado || duplicado.deletado) return null;
  return (
    <Link href={`/${duplicado.tipo === "empresa" ? "empresas" : "contatos"}/${duplicado.id}`} className="block text-xs text-fg-mute hover:text-foreground hover:underline">
      abrir {duplicado.nome} →
    </Link>
  );
}
