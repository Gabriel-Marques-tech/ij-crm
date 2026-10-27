import Link from "next/link";
import { MascotePlaca } from "@/components/marca/marca";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Sem acesso" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <MascotePlaca texto="403" alt="Mascote da Inteli Júnior segurando uma placa" />
      <p className="eyebrow">403</p>
      <h1 className="text-2xl font-semibold tracking-tight">Você não tem acesso a esta área</h1>
      <p className="max-w-sm text-sm text-fg-mute">Esta tela é restrita a gestores ou administradores.</p>
      <Button nativeButton={false} render={<Link href="/" />} variant="outline">
        Voltar ao início
      </Button>
    </div>
  );
}
