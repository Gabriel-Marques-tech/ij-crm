import type { ReactNode } from "react";
import { Rail } from "./rail";
import { Topbar } from "./topbar";

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="flex min-h-screen">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-[88px]">
        <Topbar title={title} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
