import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Sem acesso" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="eyebrow">403</p>
      <h1 className="text-2xl font-semibold tracking-tight">Você não tem acesso a esta área</h1>
      <p className="max-w-sm text-sm text-fg-mute">Esta tela é restrita a gestores ou administradores.</p>
      <Button render={<Link href="/" />} variant="outline">
        Voltar ao início
      </Button>
    </div>
  );
}
