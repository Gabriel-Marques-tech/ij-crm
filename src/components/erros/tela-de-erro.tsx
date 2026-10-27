"use client";

import { ErroCarregamento } from "@/components/erro-carregamento";
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
    <ErroCarregamento
      codigo={digest}
      acao={
        <Button variant="outline" onClick={() => retry()}>
          Tentar de novo
        </Button>
      }
    />
  );
}
