"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FILTROS_VAZIOS, OPCOES_ACAO, OPCOES_AGING, OPCOES_ORIGEM, contarAtivos, type Filtros } from "./filtros";

export type Pessoa = { id: string; nome: string };

type Props = {
  filtros: Filtros;
  onMudar: (f: Filtros) => void;
  /** Ativos primeiro; inclui quem é responsável de algum card mesmo inativo. */
  pessoas: Pessoa[];
  meuId: string;
  ufs: string[];
  visiveis: number;
  total: number;
};

const ATRASO_BUSCA_MS = 250;

function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

/** Botão "Filtros" (abre o painel) + chips dos filtros ativos + "Limpar filtros". */
export function BarraFiltros(props: Props) {
  const { filtros, onMudar, pessoas, visiveis, total } = props;
  const ativos = contarAtivos(filtros);
  const nomeDe = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? "Usuário removido";
  const rotulo = <T,>(ops: { valor: T; rotulo: string }[], v: T) => ops.find((o) => o.valor === v)?.rotulo ?? String(v);

  const chips: { chave: string; texto: string; remover: () => void }[] = [
    ...filtros.resp.map((id) => ({ chave: `resp:${id}`, texto: nomeDe(id), remover: () => onMudar({ ...filtros, resp: alternar(filtros.resp, id) }) })),
    ...(filtros.q ? [{ chave: "q", texto: `“${filtros.q}”`, remover: () => onMudar({ ...filtros, q: "" }) }] : []),
    ...(filtros.revisar
      ? [{ chave: "revisar", texto: filtros.revisar === "sim" ? "Revisar" : "Sem revisar", remover: () => onMudar({ ...filtros, revisar: null }) }]
      : []),
    ...filtros.acao.map((v) => ({ chave: `acao:${v}`, texto: `Ação: ${rotulo(OPCOES_ACAO, v)}`, remover: () => onMudar({ ...filtros, acao: alternar(filtros.acao, v) }) })),
    ...filtros.aging.map((v) => ({ chave: `aging:${v}`, texto: `Aging: ${rotulo(OPCOES_AGING, v)}`, remover: () => onMudar({ ...filtros, aging: alternar(filtros.aging, v) }) })),
    ...filtros.origem.map((v) => ({ chave: `origem:${v}`, texto: rotulo(OPCOES_ORIGEM, v), remover: () => onMudar({ ...filtros, origem: alternar(filtros.origem, v) }) })),
    ...filtros.uf.map((v) => ({ chave: `uf:${v}`, texto: v, remover: () => onMudar({ ...filtros, uf: alternar(filtros.uf, v) }) })),
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <PainelFiltros {...props} ativos={ativos} />
      {chips.map((c) => (
        <button
          key={c.chave}
          type="button"
          onClick={c.remover}
          aria-label={`Remover filtro ${c.texto}`}
          className="inline-flex h-7 max-w-56 items-center gap-1 rounded-full border border-border-strong bg-surface pr-1.5 pl-2.5 text-xs text-fg-soft outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="truncate">{c.texto}</span>
          <X aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
        </button>
      ))}
      {ativos > 0 ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => onMudar(FILTROS_VAZIOS)}>
            Limpar filtros
          </Button>
          <span className="font-mono text-xs text-fg-faint tabular" aria-live="polite">
            {visiveis} de {total} cards
          </span>
        </>
      ) : null}
    </div>
  );
}

function PainelFiltros({ filtros, onMudar, pessoas, meuId, ufs, visiveis, ativos }: Props & { ativos: number }) {
  // Busca com atraso: digita local, aplica na URL depois de uma pausa.
  const [busca, setBusca] = useState(filtros.q);
  const [qAplicado, setQAplicado] = useState(filtros.q);
  const [enviado, setEnviado] = useState(filtros.q);
  if (qAplicado !== filtros.q) {
    setQAplicado(filtros.q);
    // Só acompanha mudança que veio de fora (chip removido, "Limpar"); a que
    // nós mesmos enviamos não pode apagar o que foi digitado depois.
    if (filtros.q !== enviado) setBusca(filtros.q);
  }
  useEffect(() => {
    const q = busca.trim();
    if (q === filtros.q) return;
    const t = setTimeout(() => {
      setEnviado(q);
      onMudar({ ...filtros, q });
    }, ATRASO_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca, filtros, onMudar]);

  const soEu = filtros.resp.length === 1 && filtros.resp[0] === meuId;

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm" aria-label={ativos ? `Filtros, ${ativos} ativo(s)` : "Filtros"} />}>
        <SlidersHorizontal />
        Filtros
        {ativos ? (
          <span aria-hidden className="ml-0.5 rounded-full bg-foreground px-1.5 font-mono text-[10px] leading-4 text-background tabular">
            {ativos}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription>Aplicados na hora. O link da página guarda os filtros.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Grupo titulo="Busca">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Título ou empresa" aria-label="Buscar por título ou empresa" maxLength={100} />
          </Grupo>

          <Grupo titulo="Responsável">
            <Opcao ativo={soEu} onClick={() => onMudar({ ...filtros, resp: soEu ? [] : [meuId] })} className="mb-2">
              Meus cards
            </Opcao>
            <ul className="space-y-1">
              {pessoas.map((p) => {
                const marcado = filtros.resp.includes(p.id);
                return (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-hover">
                      <Checkbox checked={marcado} onCheckedChange={() => onMudar({ ...filtros, resp: alternar(filtros.resp, p.id) })} />
                      <span className="truncate">{p.nome}</span>
                      {p.id === meuId ? <span className="font-mono text-[10px] text-fg-faint">você</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Grupo>

          <Grupo titulo="Revisar">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [null, "Todos"],
                  ["sim", "Sim"],
                  ["nao", "Não"],
                ] as const
              ).map(([v, r]) => (
                <Opcao key={r} ativo={filtros.revisar === v} onClick={() => onMudar({ ...filtros, revisar: v })}>
                  {r}
                </Opcao>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Próxima ação">
            <Opcoes ops={OPCOES_ACAO} marcados={filtros.acao} onAlternar={(v) => onMudar({ ...filtros, acao: alternar(filtros.acao, v) })} />
          </Grupo>

          <Grupo titulo="Dias na fase">
            <Opcoes ops={OPCOES_AGING} marcados={filtros.aging} onAlternar={(v) => onMudar({ ...filtros, aging: alternar(filtros.aging, v) })} />
          </Grupo>

          <Grupo titulo="Origem">
            <Opcoes ops={OPCOES_ORIGEM} marcados={filtros.origem} onAlternar={(v) => onMudar({ ...filtros, origem: alternar(filtros.origem, v) })} />
          </Grupo>

          <Grupo titulo="Estado (UF)">
            {ufs.length ? (
              <Opcoes ops={ufs.map((u) => ({ valor: u, rotulo: u }))} marcados={filtros.uf} onAlternar={(v) => onMudar({ ...filtros, uf: alternar(filtros.uf, v) })} />
            ) : (
              <p className="text-xs text-fg-faint">Nenhum card com estado preenchido.</p>
            )}
          </Grupo>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <Button variant="ghost" size="sm" disabled={ativos === 0} onClick={() => onMudar(FILTROS_VAZIOS)}>
            Limpar filtros
          </Button>
          <span className="font-mono text-xs text-fg-faint tabular">{visiveis} card(s)</span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="eyebrow mb-2">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Opcao({ ativo, onClick, children, className }: { ativo: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        ativo ? "border-border-strong bg-surface-hover text-foreground" : "border-border text-fg-mute hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Opcoes<T extends string>({ ops, marcados, onAlternar }: { ops: { valor: T; rotulo: string }[]; marcados: T[]; onAlternar: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ops.map((o) => (
        <Opcao key={o.valor} ativo={marcados.includes(o.valor)} onClick={() => onAlternar(o.valor)}>
          {o.rotulo}
        </Opcao>
      ))}
    </div>
  );
}
