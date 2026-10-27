import Link from "next/link";

const ABAS = [
  { href: "/gestao/admin", rotulo: "Configuração" },
  { href: "/gestao/admin/logs", rotulo: "Logs" },
] as const;

export function AbasAdmin({ atual }: { atual: (typeof ABAS)[number]["href"] }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="Admin">
      {ABAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          aria-current={a.href === atual ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${a.href === atual ? "border-primary text-foreground" : "border-transparent text-fg-mute hover:text-foreground"}`}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
