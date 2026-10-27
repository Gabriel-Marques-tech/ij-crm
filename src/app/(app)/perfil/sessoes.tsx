"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Monitor } from "lucide-react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { encerrarOutrasSessoesAction, encerrarSessaoAction } from "./actions";

export type SessaoUI = { id: string; dispositivo: string; criadoEm: string; ultimoUsoEm: string; atual: boolean };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function Sessoes({ sessoes }: { sessoes: SessaoUI[] }) {
  const router = useRouter();
  const [falha, setFalha] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const outras = sessoes.filter((s) => !s.atual).length;

  function rodar(chamar: () => ReturnType<typeof encerrarOutrasSessoesAction>, acao: string) {
    setFalha(null);
    startTransition(async () => {
      const f = await executarAcao(chamar, acao);
      if (f) setFalha(f);
      else router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Sessões ativas</h2>
        {outras > 0 ? (
          <Button variant="outline" size="sm" disabled={pendente} onClick={() => rodar(() => encerrarOutrasSessoesAction(), "encerrar as outras sessões")}>
            Encerrar todas as outras
          </Button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {sessoes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Monitor className="h-4 w-4 text-fg-mute" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm">
                {s.dispositivo}
                {s.atual ? (
                  <Badge variant="outline" className="border-success/50 text-success">
                    esta sessão
                  </Badge>
                ) : null}
              </p>
              <p className="font-mono text-[11px] text-fg-mute">
                entrou {fmt.format(new Date(s.criadoEm))} · último uso {fmt.format(new Date(s.ultimoUsoEm))}
              </p>
            </div>
            {!s.atual ? (
              <Button variant="ghost" size="sm" disabled={pendente} onClick={() => rodar(() => encerrarSessaoAction(s.id), "encerrar a sessão")}>
                Encerrar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <MensagemErro falha={falha} className="text-sm" />
    </section>
  );
}
