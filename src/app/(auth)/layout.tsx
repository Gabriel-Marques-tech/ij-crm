import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell/wordmark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Wordmark />
        </div>
        {children}
      </div>
    </div>
  );
}
