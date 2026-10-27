import type { ReactNode } from "react";
import { LogoIJ, Mascote } from "@/components/marca/marca";

/** Login, esqueci, redefinir e convite: logo acima do form; mascote ao lado só em tela larga. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl items-center justify-center gap-16">
        <Mascote nome="emPe" altura={280} className="hidden shrink-0 lg:block" />
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <LogoIJ altura={72} prioridade />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
