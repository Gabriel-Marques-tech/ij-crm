"use client";

import { TelaDeErro } from "@/components/erros/tela-de-erro";

export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  return <TelaDeErro error={error} retry={retry} />;
}
