"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "cn";
import type { Papel } from "@prisma/client";
import { itemAtivo, itensParaPapel } from "./nav-config";
import { useQuadroAtivo } from "./quadro-ativo";
import { SimboloIJ } from "@/components/marca/marca";

/**
 * Rail lateral (desktop) + barra inferior (mobile).
 * Visual: bg-subtle (sidebar) com borda, item ativo em primary-soft + coral.
 * Recebe só o papel (serializável); ícones são resolvidos aqui, no client.
 */
export function Rail({ papel }: { papel: Papel }) {
  const pathname = usePathname();
  // Vendas e Projetos são o mesmo /kanban: na lista o quadro vem do ?quadro=;
  // no detalhe, a página declara o quadro do card (`MarcarQuadroAtivo`).
  const parametro = useSearchParams().get("quadro");
  const declarado = useQuadroAtivo();
  const quadro = declarado ?? parametro;
  const itens = itensParaPapel(papel);

  return (
    <>
      {/* desktop */}
      <nav
        aria-label="Principal"
        className="hidden md:flex fixed inset-y-0 left-0 w-[88px] flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4"
      >
        {/* Rail estreito (88 px): só o símbolo; o logo inteiro ficaria ilegível. */}
        <Link href="/" className="mb-4 flex size-[60px] items-center justify-center rounded-xl bg-primary-soft/40 ring-1 ring-primary/20 hover:bg-primary-soft/70" title="Início">
          <SimboloIJ tamanho={48} />
        </Link>
        {itens.map((item) => {
          const active = itemAtivo(item, pathname, quadro);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-[72px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors",
                active
                  ? "bg-primary-soft text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-center leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* mobile */}
      <nav
        aria-label="Principal"
        className="md:hidden fixed inset-x-0 bottom-0 z-20 flex border-t border-sidebar-border bg-sidebar"
      >
        {itens.map((item) => {
          const active = itemAtivo(item, pathname, quadro);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
                active ? "text-primary" : "text-sidebar-foreground",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
            </Link>
          );
        })}
      </nav>
    </>
  );
}
