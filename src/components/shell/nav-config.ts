import type { Papel } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  Contact,
  FolderKanban,
  KanbanSquare,
  Settings2,
  Table2,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** papel mínimo para ver o item; undefined = todos */
  minPapel?: "GESTOR" | "ADMIN";
  /** Item de um quadro do Kanban (alternador Vendas/Projetos): ativo pelo quadro da página. */
  quadro?: string;
};

/** Quadro que `/kanban` mostra sem `?quadro=` (ver `kanban/page.tsx`). */
export const QUADRO_PADRAO = "vendas";

export const NAV_ITEMS: NavItem[] = [
  { href: "/semana", label: "Minha Semana", icon: CalendarCheck },
  { href: "/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/kanban", label: "Vendas", icon: KanbanSquare, quadro: "vendas" },
  { href: "/kanban?quadro=projetos", label: "Projetos", icon: FolderKanban, quadro: "projetos" },
  { href: "/tabela", label: "Tabela", icon: Table2 },
  { href: "/contatos", label: "Contatos", icon: Contact },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/ranking", label: "Ranking", icon: Trophy },
  { href: "/gestao", label: "Gestão", icon: Settings2, minPapel: "GESTOR" },
];

export function itensParaPapel(papel: Papel): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.minPapel || temPapelMinimo(papel, i.minPapel));
}

/** Item ativo: "/" só em match exato; demais por prefixo. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Item ativo considerando o quadro do Kanban. `quadro` = o declarado pela página
 * (detalhe do card, ver `quadro-ativo.tsx`) ou o `?quadro=` da lista. Na lista
 * sem `?quadro=` vale o padrão; no detalhe sem quadro declarado nenhum acende.
 */
export function itemAtivo(item: NavItem, pathname: string, quadro: string | null): boolean {
  if (!item.quadro) return isActive(pathname, item.href);
  if (!isActive(pathname, "/kanban")) return false;
  return (quadro ?? (pathname === "/kanban" ? QUADRO_PADRAO : null)) === item.quadro;
}
