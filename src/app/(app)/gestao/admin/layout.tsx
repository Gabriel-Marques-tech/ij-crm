import type { ReactNode } from "react";
import { exigirPapel } from "@/lib/auth/atual";

/** Admin (GAB-42): config técnica e logs. Gestor e vendedor → 403. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await exigirPapel("ADMIN");
  return <>{children}</>;
}
