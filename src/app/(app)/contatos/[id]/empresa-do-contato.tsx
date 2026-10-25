"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Building2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { BuscaEntidade } from "@/components/entidades/busca-entidade";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { buscarEmpresasParaAutocomplete } from "../../empresas/buscar";
import { definirEmpresaDoContatoAction } from "../actions";

/** Empresa do contato (opcional): escolha explícita no autocomplete. */
export function EmpresaDoContato({ contatoId, empresa }: { contatoId: string; empresa: { id: string; nome: string } | null }) {
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function definir(empresaId: string | null) {
    startTransition(async () => {
      const falha = await executarAcao(() => definirEmpresaDoContatoAction(contatoId, empresaId), "salvar a empresa");
      setErro(falha);
      if (!falha) setTrocando(false);
    });
  }

  return (
    <div>
      <p className="eyebrow mb-1">Empresa</p>
      {empresa && !trocando ? (
        <div className="flex items-center gap-2">
          <Building2 className="size-3.5 text-fg-mute" aria-hidden />
          <Link href={`/empresas/${empresa.id}`} className="truncate text-sm text-foreground hover:underline">
            {empresa.nome}
          </Link>
          <span className="ml-auto flex gap-1">
            <Button type="button" variant="ghost" size="xs" disabled={pendente} onClick={() => setTrocando(true)}>
              trocar
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" disabled={pendente} onClick={() => definir(null)} aria-label="Tirar empresa" title="Tirar empresa">
              <X />
            </Button>
          </span>
        </div>
      ) : (
        <div className="space-y-1">
          <BuscaEntidade rotulo="Buscar empresa" placeholder="buscar empresa pelo nome" buscar={buscarEmpresasParaAutocomplete} desabilitado={pendente} autoFocus={trocando} onEscolher={(o) => definir(o.id)} />
          {trocando ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => setTrocando(false)}>
              cancelar
            </Button>
          ) : null}
        </div>
      )}
      <MensagemErro falha={erro} className="mt-1" />
    </div>
  );
}
