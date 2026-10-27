"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "cn";

const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";

/** Meu | Time | Pessoa ▾ (padrão "Meu"). Mantém o período na URL. */
export function SeletorVisao({
  modo,
  pessoaId,
  eu,
  opcoes,
  periodo,
}: {
  modo: "meu" | "time" | "pessoa";
  pessoaId: string | null;
  eu: string;
  opcoes: { id: string; nome: string }[];
  /** `?periodo=`/`?data=` atuais (ver `paramsDoPeriodo`). */
  periodo: Record<string, string>;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...extra, ...periodo });
    const s = q.toString();
    return s ? `/calendario?${s}` : "/calendario";
  };
  return (
    <nav aria-label="De quem" className="flex items-center rounded-lg border border-border bg-surface p-0.5">
      <Link href={href({})} aria-current={modo === "meu" ? "page" : undefined} className={cn(ABA, modo === "meu" ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
        Meu
      </Link>
      <Link href={href({ ver: "time" })} aria-current={modo === "time" ? "page" : undefined} className={cn(ABA, modo === "time" ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
        Time
      </Link>
      <label className="sr-only" htmlFor="calendario-pessoa">
        Pessoa
      </label>
      <select
        id="calendario-pessoa"
        value={modo === "pessoa" && pessoaId ? pessoaId : ""}
        disabled={pendente}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(() => router.push(v && v !== eu ? href({ pessoa: v }) : href({})));
        }}
        className={cn(ABA, "max-w-40 cursor-pointer border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50", modo === "pessoa" ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}
      >
        <option value="">Pessoa ▾</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === eu ? `${o.nome} (você)` : o.nome}
          </option>
        ))}
      </select>
    </nav>
  );
}
