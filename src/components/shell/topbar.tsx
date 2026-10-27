import Link from "next/link";
import { LogOut } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";
import type { UsuarioSessao } from "@/lib/auth/sessao";
import { SimboloIJ } from "@/components/marca/marca";
import type { DestinoInicio } from "@/lib/preferencias/preferencias";

const ROTULO_PAPEL = { ADMIN: "admin", GESTOR: "gestor", VENDEDOR: "vendedor" } as const;

export function Topbar({ usuario, inicio }: { usuario: UsuarioSessao; inicio: DestinoInicio }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
      <Link href={inicio} className="md:hidden" title="Início">
        <SimboloIJ tamanho={32} />
      </Link>
      <span className="hidden md:block" />
      <div className="flex items-center gap-3">
        <Link href="/perfil" className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-hover" title="Meu perfil">
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight text-fg-soft">{usuario.nome}</p>
            <p className="eyebrow">{ROTULO_PAPEL[usuario.papel]}</p>
          </div>
          <Avatar nome={usuario.nome} usuarioId={usuario.id} fotoEm={usuario.fotoEm} tamanho="sm" />
        </Link>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sair" title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
