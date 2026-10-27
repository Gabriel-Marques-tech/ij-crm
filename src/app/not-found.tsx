import Link from "next/link";
import { MascotePlaca } from "@/components/marca/marca";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Página não encontrada" };

/** 404 da app inteira (rota inexistente ou `notFound()`), no mesmo molde do /403. */
export default function NaoEncontrada() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <MascotePlaca texto="404" alt="Mascote da Inteli Júnior segurando uma placa" />
      <p className="eyebrow">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-fg-mute">O endereço não existe ou o item foi removido.</p>
      <Button nativeButton={false} render={<Link href="/" />} variant="outline">
        Voltar ao início
      </Button>
    </div>
  );
}
