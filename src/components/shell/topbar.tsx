import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";
import type { UsuarioSessao } from "@/lib/auth/sessao";
import { Wordmark } from "./wordmark";

const ROTULO_PAPEL = { ADMIN: "admin", GESTOR: "gestor", VENDEDOR: "vendedor" } as const;

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

export function Topbar({ usuario }: { usuario: UsuarioSessao }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
      <span className="md:hidden">
        <Wordmark compact />
      </span>
      <span className="hidden md:block" />
      <div className="flex items-center gap-3">
        <Link href="/perfil" className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-hover" title="Meu perfil">
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight text-fg-soft">{usuario.nome}</p>
            <p className="eyebrow">{ROTULO_PAPEL[usuario.papel]}</p>
          </div>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong bg-surface font-mono text-xs text-fg-soft"
            aria-hidden
          >
            {iniciais(usuario.nome)}
          </div>
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
