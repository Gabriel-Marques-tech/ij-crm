"use client";

import { ErroCarregamento } from "@/components/erro-carregamento";
import { MascotePlaca } from "@/components/marca/marca";
import { Button } from "@/components/ui/button";

/**
 * Corpo dos error boundaries (error.tsx / global-error.tsx). Erro vindo do
 * servidor traz `digest` = ref já logada por `onRequestError`; nunca mostramos
 * `message`/stack (em dev o Next manda a mensagem original).
 */
export function TelaDeErro({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
  return (
    <div className="flex flex-col items-center gap-6">
      <MascotePlaca texto="ops" altura={180} alt="Mascote da Inteli Júnior segurando uma placa" />
      <div className="w-full">
        <ErroCarregamento
          codigo={digest}
          acao={
            <Button variant="outline" onClick={() => retry()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    </div>
  );
}
