import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { exigirUsuario } from "@/lib/auth/atual";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const usuario = await exigirUsuario();
  return <AppShell usuario={usuario}>{children}</AppShell>;
}
