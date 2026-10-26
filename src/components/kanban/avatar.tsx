import { Avatar as AvatarBase, iniciais } from "@/components/avatar";

export { iniciais };

/** Avatar do responsável no Kanban: o compartilhado (`@/components/avatar`) com rótulo "Responsável". */
export function Avatar({
  nome,
  usuarioId,
  fotoEm,
  className,
}: {
  nome: string;
  usuarioId?: string | null;
  fotoEm?: number | null;
  className?: string;
}) {
  return <AvatarBase nome={nome} usuarioId={usuarioId} fotoEm={fotoEm} rotulo={`Responsável: ${nome}`} className={className} />;
}
