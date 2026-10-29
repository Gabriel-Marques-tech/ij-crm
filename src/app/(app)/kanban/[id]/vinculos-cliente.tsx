"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Building2, Contact, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { BuscaEntidade, type OpcaoBusca } from "@/components/entidades/busca-entidade";
import { VinculoLink } from "@/components/entidades/vinculo-link";
import type { Vinculo } from "@/lib/entidades/vinculo";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";
import type { Duplicado, EstadoEntidade } from "@/lib/entidades/mensagens";
import { buscarEmpresasParaAutocomplete as buscarEmpresas } from "../../empresas/buscar";
import { buscarContatosParaAutocomplete as buscarContatos } from "../../contatos/buscar";
import { criarEVincularContatoAction, criarEVincularEmpresaAction, vincularAction } from "./vinculos-actions";

type Ref = Vinculo | null;

/** Chama a action; rejeição = transporte. Devolve a resposta e a falha já traduzida. */
async function chamar(fn: () => Promise<EstadoEntidade>, acao: string): Promise<{ r?: EstadoEntidade; falha: FalhaUI | null }> {
  try {
    const r = await fn();
    return { r, falha: falhaDe(r, acao) };
  } catch {
    return { falha: FALHA_CONEXAO };
  }
}

/**
 * Empresa e Contato do card (GAB-31). Autocomplete por nome só exibe; o
 * vínculo é a escolha explícita. Cada troca vira Timeline CAMPO_ALTERADO.
 * `somenteLeitura` (VISUALIZADOR): só os links, sem busca/trocar/criar.
 */
export function VinculosCliente({ cardId, empresa, contato, somenteLeitura = false }: { cardId: string; empresa: Ref; contato: Ref; somenteLeitura?: boolean }) {
  if (somenteLeitura) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-4 text-sm font-medium">Empresa e contato</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {([["empresa", "Empresa", empresa, Building2], ["contato", "Contato", contato, Contact]] as const).map(([tipo, rotulo, v, Icone]) => (
            <div key={tipo}>
              <p className="eyebrow mb-1">{rotulo}</p>
              {v ? (
                <span className="flex items-center gap-2 text-sm">
                  <Icone className="size-3.5 shrink-0 text-fg-mute" aria-hidden />
                  <span className="min-w-0 truncate">
                    <VinculoLink tipo={tipo} vinculo={v} />
                  </span>
                </span>
              ) : (
                <p className="text-sm text-fg-faint">—</p>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-4 text-sm font-medium">Empresa e contato</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <VinculoEmpresa cardId={cardId} atual={empresa} />
        <VinculoContato cardId={cardId} atual={contato} empresaDoCard={empresa?.estado === "ATIVO" ? empresa : null} />
      </div>
    </section>
  );
}

function Atual({ tipo, vinculo, icone: Icone, onTrocar, onRemover, pendente, rotulo }: {
  tipo: "empresa" | "contato";
  vinculo: Vinculo;
  icone: typeof Building2;
  onTrocar: () => void;
  onRemover: () => void;
  pendente: boolean;
  rotulo: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icone className="size-3.5 shrink-0 text-fg-mute" aria-hidden />
      <span className="min-w-0 truncate text-sm">
        <VinculoLink tipo={tipo} vinculo={vinculo} />
      </span>
      <span className="ml-auto flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="xs" disabled={pendente} onClick={onTrocar}>
          trocar
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" disabled={pendente} onClick={onRemover} aria-label={`Desvincular ${rotulo.toLowerCase()}`} title="Desvincular">
          <X />
        </Button>
      </span>
    </div>
  );
}

function VinculoEmpresa({ cardId, atual }: { cardId: string; atual: Ref }) {
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function executar(fn: () => Promise<EstadoEntidade>, acao: string) {
    startTransition(async () => {
      const { falha } = await chamar(fn, acao);
      setErro(falha);
      if (!falha) setBuscando(false);
    });
  }

  return (
    <div>
      <p className="eyebrow mb-1">Empresa</p>
      {atual && !buscando ? (
        <Atual
          tipo="empresa"
          vinculo={atual}
          icone={Building2}
          rotulo="empresa"
          pendente={pendente}
          onTrocar={() => setBuscando(true)}
          onRemover={() => executar(() => vincularAction(cardId, "empresa", null), "desvincular a empresa")}
        />
      ) : (
        <div className="space-y-1">
          <BuscaEntidade
            rotulo="Buscar empresa"
            placeholder="buscar empresa pelo nome"
            buscar={buscarEmpresas}
            desabilitado={pendente}
            autoFocus={buscando}
            rotuloCriar="Criar empresa"
            onEscolher={(o: OpcaoBusca) => executar(() => vincularAction(cardId, "empresa", o.id), "vincular a empresa")}
            onCriar={(nome) => executar(() => criarEVincularEmpresaAction(cardId, nome), "criar a empresa")}
          />
          {buscando ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => setBuscando(false)}>
              cancelar
            </Button>
          ) : null}
        </div>
      )}
      <MensagemErro falha={erro} className="mt-1" />
    </div>
  );
}

function VinculoContato({ cardId, atual, empresaDoCard }: { cardId: string; atual: Ref; empresaDoCard: Ref }) {
  const [buscando, setBuscando] = useState(false);
  const [novo, setNovo] = useState<{ nome: string; telefone: string; email: string; naEmpresa: boolean } | null>(null);
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function limpar() {
    setBuscando(false);
    setNovo(null);
    setDuplicado(null);
  }

  function executar(fn: () => Promise<EstadoEntidade>, acao: string) {
    startTransition(async () => {
      const { r, falha } = await chamar(fn, acao);
      setErro(falha);
      setDuplicado(r && "duplicado" in r && r.duplicado ? r.duplicado : null);
      if (!falha) limpar();
    });
  }

  function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo?.nome.trim()) return;
    executar(
      () => criarEVincularContatoAction(cardId, { nome: novo.nome, telefone: novo.telefone, email: novo.email, empresaId: empresaDoCard && novo.naEmpresa ? empresaDoCard.id : null }),
      "criar o contato",
    );
  }

  return (
    <div>
      <p className="eyebrow mb-1">Contato</p>
      {atual && !buscando && !novo ? (
        <Atual
          tipo="contato"
          vinculo={atual}
          icone={Contact}
          rotulo="contato"
          pendente={pendente}
          onTrocar={() => setBuscando(true)}
          onRemover={() => executar(() => vincularAction(cardId, "contato", null), "desvincular o contato")}
        />
      ) : novo ? (
        <form onSubmit={criar} className="space-y-2 rounded-lg border border-border bg-background/40 p-2">
          <Input aria-label="Nome do contato" value={novo.nome} maxLength={200} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="nome" autoFocus />
          <Input aria-label="Telefone" value={novo.telefone} inputMode="tel" onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} placeholder="telefone (opcional)" />
          <Input aria-label="Email" value={novo.email} type="email" onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="email (opcional)" />
          {empresaDoCard ? (
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              <input type="checkbox" checked={novo.naEmpresa} onChange={(e) => setNovo({ ...novo, naEmpresa: e.target.checked })} className="accent-primary" />
              Vincular à empresa {empresaDoCard.nome}
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={limpar} disabled={pendente}>
              cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pendente || !novo.nome.trim()}>
              Criar e vincular
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-1">
          <BuscaEntidade
            rotulo="Buscar contato"
            placeholder="buscar contato pelo nome"
            buscar={buscarContatos}
            desabilitado={pendente}
            autoFocus={buscando}
            rotuloCriar="Criar contato"
            onEscolher={(o) => executar(() => vincularAction(cardId, "contato", o.id), "vincular o contato")}
            onCriar={(nome) => {
              setErro(null);
              setNovo({ nome, telefone: "", email: "", naEmpresa: true });
            }}
          />
          {buscando ? (
            <Button type="button" variant="ghost" size="xs" onClick={limpar}>
              cancelar
            </Button>
          ) : null}
        </div>
      )}
      <MensagemErro falha={erro} className="mt-1" />
      {duplicado && !duplicado.deletado ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-soft">
          <span>Vincular {duplicado.nome}?</span>
          <Button type="button" size="xs" disabled={pendente} onClick={() => executar(() => vincularAction(cardId, "contato", duplicado.id), "vincular o contato")}>
            Vincular {duplicado.nome}
          </Button>
          <Link href={`/contatos/${duplicado.id}`} className="text-fg-mute hover:text-foreground hover:underline">
            ver contato
          </Link>
        </div>
      ) : null}
    </div>
  );
}
