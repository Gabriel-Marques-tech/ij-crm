import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";

const hoje = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

// Data do dia muda a cada request: rota dinâmica, sem prerender (Next 16).
export const instant = false;

export default async function HomePage() {
  await connection();
  return (
    <>
      <PageHeader
        eyebrow={hoje.format(new Date())}
        title="Boa tarde."
        description="Sua semana aparece aqui quando o Kanban e as próximas ações existirem (GAB-29, GAB-33)."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5 md:col-span-2">
          <p className="eyebrow mb-3">agora</p>
          <div className="flex items-center gap-4">
            <Wordmark />
          </div>
          <p className="mt-4 text-sm text-fg-mute">
            Shell do app pronto: tokens, rail, tipografia. Nada de dado ainda.
          </p>
          <div className="mt-5 flex gap-2">
            <Button>Primária</Button>
            <Button variant="outline">Secundária</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="eyebrow mb-3">aging (preview)</p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="font-mono tabular text-fg-soft">3d</span>
              <span className="text-fg-mute">na fase</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-warn" />
              <span className="font-mono tabular text-fg-soft">9d</span>
              <span className="text-fg-mute">na fase</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-danger" />
              <span className="font-mono tabular text-fg-soft">21d</span>
              <span className="text-fg-mute">na fase</span>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
