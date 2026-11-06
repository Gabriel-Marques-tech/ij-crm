import Link from "next/link";
import { cn } from "cn";

/**
 * Abas do projeto (Visão geral | Tarefas | Equipe): o kanban interno e a equipe ficam
 * DENTRO do projeto. Só no quadro de Projetos e para o time de projetos (quem chama
 * decide). `tarefasAbertas` null = a pessoa não está escalada: a aba Tarefas some.
 */
export function AbasProjeto({ projetoId, ativa, tarefasAbertas }: { projetoId: string; ativa: "geral" | "tarefas" | "equipe"; tarefasAbertas: number | null }) {
  const abas = [
    { chave: "geral", rotulo: "Visão geral", href: `/projetos/${projetoId}`, contagem: null },
    ...(tarefasAbertas !== null ? [{ chave: "tarefas", rotulo: "Tarefas", href: `/projetos/${projetoId}/tarefas`, contagem: tarefasAbertas }] : []),
    { chave: "equipe", rotulo: "Equipe", href: `/projetos/${projetoId}/equipe`, contagem: null },
  ];
  return (
    <nav aria-label="Seções do projeto" className="mb-4 flex shrink-0 gap-1 border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          aria-current={ativa === a.chave ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            ativa === a.chave ? "border-primary text-foreground" : "border-transparent text-fg-mute hover:text-foreground",
          )}
        >
          {a.rotulo}
          {a.contagem !== null ? <span className="font-mono text-[11px] text-fg-faint tabular">{a.contagem}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
