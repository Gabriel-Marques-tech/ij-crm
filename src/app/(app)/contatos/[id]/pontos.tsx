"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Mail, Phone, X } from "lucide-react";
import type { TipoContatoPonto } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";
import type { Duplicado } from "@/lib/entidades/mensagens";
import { adicionarPontoAction, removerPontoAction } from "../actions";

type Ponto = { id: string; tipo: TipoContatoPonto; valorNormalizado: string; valorOriginal: string };

/** Telefones e emails do contato: acumulam (adicionar/remover), sempre normalizados no servidor. */
export function Pontos({ contatoId, pontos }: { contatoId: string; pontos: Ponto[] }) {
  const [tipo, setTipo] = useState<TipoContatoPonto>("TELEFONE");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const [pendente, startTransition] = useTransition();

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!valor.trim()) return;
    startTransition(async () => {
      try {
        const r = await adicionarPontoAction(contatoId, tipo, valor);
        const falha = falhaDe(r, "adicionar");
        setErro(falha);
        setDuplicado("duplicado" in r && r.duplicado ? r.duplicado : null);
        if (!falha) setValor("");
      } catch {
        setErro(FALHA_CONEXAO);
      }
    });
  }

  function remover(pontoId: string) {
    startTransition(async () => {
      try {
        setErro(falhaDe(await removerPontoAction(contatoId, pontoId), "remover"));
        setDuplicado(null);
      } catch {
        setErro(FALHA_CONEXAO);
      }
    });
  }

  return (
    <div className="space-y-3">
      {pontos.length === 0 ? <p className="text-sm text-fg-faint">Nenhum telefone ou email.</p> : null}
      <ul className="space-y-1">
        {pontos.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            {p.tipo === "TELEFONE" ? <Phone className="size-3.5 text-fg-mute" aria-label="Telefone" /> : <Mail className="size-3.5 text-fg-mute" aria-label="Email" />}
            <span className="font-mono tabular text-foreground">{p.valorNormalizado}</span>
            {p.valorOriginal !== p.valorNormalizado ? <span className="truncate font-mono text-[11px] text-fg-faint" title="como foi digitado">{p.valorOriginal}</span> : null}
            <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" disabled={pendente} onClick={() => remover(p.id)} aria-label={`Remover ${p.valorNormalizado}`}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={adicionar} className="flex flex-wrap gap-2">
        <label htmlFor="ponto-tipo" className="sr-only">
          Tipo
        </label>
        <select
          id="ponto-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoContatoPonto)}
          className="h-8 rounded-lg border border-input bg-input/30 px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="TELEFONE">Telefone</option>
          <option value="EMAIL">Email</option>
        </select>
        <label htmlFor="ponto-valor" className="sr-only">
          {tipo === "TELEFONE" ? "Telefone" : "Email"}
        </label>
        <Input
          id="ponto-valor"
          className="w-auto min-w-48 flex-1"
          inputMode={tipo === "TELEFONE" ? "tel" : "email"}
          value={valor}
          maxLength={200}
          placeholder={tipo === "TELEFONE" ? "11 99999-8888" : "nome@empresa.com.br"}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button type="submit" size="sm" className="h-8" disabled={pendente || !valor.trim()}>
          Adicionar
        </Button>
      </form>
      <MensagemErro falha={erro} />
      {duplicado ? (
        <Link href={`/contatos/${duplicado.id}`} className="block text-xs text-fg-mute hover:text-foreground hover:underline">
          abrir {duplicado.nome} →
        </Link>
      ) : null}
    </div>
  );
}
