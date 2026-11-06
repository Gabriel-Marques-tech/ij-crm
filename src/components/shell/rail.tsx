"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { useNavegacaoArea } from "./area-atual";
import { BotaoGaveta, GavetaIJ, IndicadorArea } from "./gaveta-ij";
import { ehRotaGG, itemAtivo, itensDoMenu, ITENS_GG } from "./nav-config";

/**
 * Rail lateral (desktop) + barra inferior (mobile), com os itens da área atual.
 * Visual: bg-subtle (sidebar) com borda, item ativo em primary-soft + coral.
 * O ícone da IJ abre a gaveta; no mobile ele fica na topbar.
 */
export function Rail() {
  const pathname = usePathname();
  const { pessoa, area, quadro } = useNavegacaoArea();
  const itens = ehRotaGG(pathname) ? ITENS_GG : itensDoMenu(pessoa, area);

  return (
    <>
      {/* desktop */}
      <nav
        aria-label="Principal"
        className="hidden md:flex fixed inset-y-0 left-0 w-[88px] flex-col items-center gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar py-4"
      >
        {/* Rail estreito (88 px): só o símbolo; o logo inteiro ficaria ilegível. */}
        <BotaoGaveta
          tamanho={48}
          className="mb-2 flex size-[60px] shrink-0 items-center justify-center rounded-xl bg-primary-soft/40 ring-1 ring-primary/20 hover:bg-primary-soft/70"
        />
        <IndicadorArea className="mb-3 w-[72px] shrink-0" />
        {itens.map((item) => {
          const active = itemAtivo(item, pathname, quadro);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-[72px] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors",
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

      <GavetaIJ />
    </>
  );
}
