import { Wordmark } from "./wordmark";

export function Topbar({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-3">
        <span className="md:hidden">
          <Wordmark compact />
        </span>
        {title ? <h1 className="text-sm font-medium text-fg-soft">{title}</h1> : null}
      </div>
      {/* usuário/logout entram em GAB-26 */}
      <div className="h-8 w-8 rounded-full border border-border-strong bg-surface" aria-hidden />
    </header>
  );
}
