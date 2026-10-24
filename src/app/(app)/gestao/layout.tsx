import type { ReactNode } from "react";
import { exigirPapel } from "@/lib/auth/atual";

export default async function GestaoLayout({ children }: { children: ReactNode }) {
  await exigirPapel("GESTOR");
  return <>{children}</>;
}
