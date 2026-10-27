"use client";

import { TelaDeErro } from "@/components/erros/tela-de-erro";

export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <TelaDeErro error={error} retry={retry} />
    </main>
  );
}
