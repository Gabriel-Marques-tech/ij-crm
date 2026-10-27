"use client";

import { TelaDeErro } from "@/components/erros/tela-de-erro";
import "./globals.css";

/** Falha no root layout: substitui o documento inteiro, então traz html/body e o tema escuro. */
export default function ErroGlobal({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="pt-BR" className="dark h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <title>Erro · IJ CRM</title>
        <main className="mx-auto w-full max-w-lg px-4 py-16">
          <TelaDeErro error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
