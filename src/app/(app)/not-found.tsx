import Link from "next/link";
import { MascotePlaca } from "@/components/marca/marca";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Não encontrado" };

/**
 * `notFound()` dentro da app (card, contato ou empresa que não existe): fica
 * dentro do layout de (app), com rail e topbar. Rota fora de tudo cai no
 * `src/app/not-found.tsx` da raiz.
 */
export default function NaoEncontradaApp() {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <MascotePlaca texto="404" alt="Mascote da Inteli Júnior segurando uma placa" />
      <p className="eyebrow">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Não encontramos isso</h1>
      <p className="max-w-sm text-sm text-fg-mute">O item não existe ou foi para a lixeira.</p>
      <Button nativeButton={false} render={<Link href="/" />} variant="outline">
        Voltar ao início
      </Button>
    </div>
  );
}
