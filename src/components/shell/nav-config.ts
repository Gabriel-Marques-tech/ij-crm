import type { Papel } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";
import {
  Building2,
  CalendarCheck,
  Contact,
  KanbanSquare,
  Settings2,
  Table2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** papel mínimo para ver o item; undefined = todos */
  minPapel?: "GESTOR" | "ADMIN";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Minha Semana", icon: CalendarCheck },
  { href: "/kanban", label: "Kanban", icon: KanbanSquare },
  { href: "/tabela", label: "Tabela", icon: Table2 },
  { href: "/contatos", label: "Contatos", icon: Contact },
  { href: "/empresas", label: "Empresas", icon: Building2 },
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
