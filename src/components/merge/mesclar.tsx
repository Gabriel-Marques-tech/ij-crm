"use client";

import { useState, useTransition } from "react";
import { Merge } from "lucide-react";
import { cn } from "cn";
import { BuscaEntidade, type OpcaoBusca } from "@/components/entidades/busca-entidade";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { mesclarAction, previaMergeAction } from "@/app/(app)/_lixeira/actions";
import { buscarContatosParaAutocomplete } from "@/app/(app)/contatos/buscar";
import { buscarEmpresasParaAutocomplete } from "@/app/(app)/empresas/buscar";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";
import type { PreviaMerge } from "@/lib/merge/merge";

type Tipo = "contato" | "empresa";

const TEXTO: Record<Tipo, { duplicado: string; itens: (c: PreviaMerge["resultado"]) => string }> = {
  contato: { duplicado: "contato duplicado", itens: (c) => `${c.pontos} telefone(s)/email(s) · ${c.projetos} projeto(s)` },
  empresa: { duplicado: "empresa duplicada", itens: (c) => `${c.contatos} contato(s) · ${c.projetos} projeto(s)` },
};

/**
 * Merge manual (gestor+): escolhe o duplicado, decide qual fica como
 * principal, vê a prévia (o que o principal vai mostrar) e confirma. Nada é
 * copiado nem apagado; dá para desfazer no detalhe do principal.
 */
export function Mesclar({ tipo, atual }: { tipo: Tipo; atual: { id: string; nome: string } }) {
  const [outro, setOutro] = useState<OpcaoBusca | null>(null);
  const [principalEhAtual, setPrincipalEhAtual] = useState(true);
  const [previa, setPrevia] = useState<PreviaMerge | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  const buscar = tipo === "contato" ? buscarContatosParaAutocomplete : buscarEmpresasParaAutocomplete;

  const principal = outro ? (principalEhAtual ? atual : outro) : null;
  const perdedor = outro ? (principalEhAtual ? outro : atual) : null;

  function escolher(o: OpcaoBusca) {
    setPrevia(null);
    if (o.id === atual.id) {
      setErro({ texto: "Escolha outro registro, não este mesmo." });
      return;
    }
    setErro(null);
    setOutro(o);
  }

  function chamar<T>(fn: () => Promise<T & { ok?: boolean; erro?: string; ref?: string }>, acao: string, ok: (r: T) => void) {
    startTransition(async () => {
      try {
        const r = await fn();
        const f = falhaDe(r, acao);
        setErro(f);
        if (!f) ok(r);
      } catch {
        setErro(FALHA_CONEXAO);
      }
    });
  }

  return (
    <div className="space-y-3">
      <BuscaEntidade rotulo={`Buscar ${TEXTO[tipo].duplicado}`} placeholder={`buscar ${TEXTO[tipo].duplicado} por nome`} buscar={buscar} onEscolher={escolher} desabilitado={pendente} />
      {outro ? (
        <fieldset className="space-y-1.5" disabled={pendente}>
          <legend className="mb-1 text-xs text-fg-mute">Qual fica como principal?</legend>
          {[true, false].map((ehAtual) => {
            const r = ehAtual ? atual : outro;
            return (
              <label key={String(ehAtual)} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", principalEhAtual === ehAtual ? "border-primary bg-primary-soft" : "border-border")}>
                <input
                  type="radio"
                  name="principal"
                  checked={principalEhAtual === ehAtual}
                  onChange={() => {
                    setPrincipalEhAtual(ehAtual);
                    setPrevia(null);
                  }}
                />
                <span className="truncate text-foreground">{r.nome}</span>
                {ehAtual ? <span className="font-mono text-[11px] text-fg-mute">(este)</span> : null}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {previa ? (
        <div className="rounded-lg border border-border bg-surface-strong p-3 text-sm">
          <p className="text-fg-soft">
            <b className="font-medium text-foreground">{previa.perdedor.nome}</b> passa a aparecer dentro de <b className="font-medium text-foreground">{previa.principal.nome}</b>.
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular">
            <dt className="text-fg-mute">principal hoje</dt>
            <dd>{TEXTO[tipo].itens(previa.principal.contagens)}</dd>
            <dt className="text-fg-mute">vem do duplicado</dt>
            <dd>{TEXTO[tipo].itens(previa.perdedor.contagens)}</dd>
            <dt className="text-fg-mute">depois do merge</dt>
            <dd className="text-foreground">{TEXTO[tipo].itens(previa.resultado)}</dd>
          </dl>
          <p className="mt-2 text-xs text-fg-mute">Nada é copiado nem apagado. Dá para desfazer no detalhe do principal.</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        {outro && !previa ? (
          <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => chamar(() => previaMergeAction(tipo, principal!.id, perdedor!.id), "ver a prévia", (r) => setPrevia("previa" in r && r.previa ? r.previa : null))}>
            Ver prévia
          </Button>
        ) : null}
        {previa ? (
          <Button type="button" size="sm" disabled={pendente} onClick={() => chamar(() => mesclarAction(tipo, previa.principal.id, previa.perdedor.id), "mesclar", () => undefined)}>
            <Merge aria-hidden /> Confirmar merge
          </Button>
        ) : null}
        {outro ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pendente}
            onClick={() => {
              setOutro(null);
              setPrevia(null);
              setErro(null);
            }}
          >
            Cancelar
          </Button>
        ) : null}
      </div>
      <MensagemErro falha={erro} />
    </div>
  );
}
