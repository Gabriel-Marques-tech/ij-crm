import { PageHeader } from "./page-header";

export function EmBreve({ title, ticket, description }: { title: string; ticket: string; description: string }) {
  return (
    <>
      <PageHeader eyebrow={`em breve · ${ticket}`} title={title} description={description} />
      <div className="rounded-xl border border-dashed border-border-strong bg-surface/40 p-10 text-center text-sm text-fg-faint">
        Esta tela chega no ticket <span className="font-mono text-fg-mute">{ticket}</span>.
      </div>
    </>
  );
}
