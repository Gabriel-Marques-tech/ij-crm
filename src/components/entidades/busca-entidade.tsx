"use client";

import { useId, useRef, useState } from "react";
import { cn } from "cn";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { FALHA_CONEXAO, falhaDe, type FalhaUI } from "@/lib/erros/cliente";

export type OpcaoBusca = { id: string; nome: string; detalhe?: string | null };

export type RespostaBusca = { ok: true; opcoes: OpcaoBusca[] } | { ok?: false; erro: string; ref?: string };

const ESPERA_MS = 200;

/**
 * Autocomplete por nome (combobox). A busca é só para EXIBIR opções — nada
 * é vinculado sem o usuário escolher uma linha (ou "Criar …").
 */
export function BuscaEntidade({
  rotulo,
  placeholder,
  buscar,
  onEscolher,
  onCriar,
  rotuloCriar = "Criar",
  desabilitado,
  autoFocus,
}: {
  rotulo: string;
  placeholder?: string;
  buscar: (q: string) => Promise<RespostaBusca>;
  onEscolher: (o: OpcaoBusca) => void;
  /** Sem ele, não oferece criar. Recebe o texto digitado. */
  onCriar?: (q: string) => void;
  rotuloCriar?: string;
  desabilitado?: boolean;
  autoFocus?: boolean;
}) {
  const idBase = useId();
  const [q, setQ] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultima = useRef(0);

  const termo = q.trim();
  const linhas: ({ tipo: "opcao"; o: OpcaoBusca } | { tipo: "criar" })[] = [
    ...opcoes.map((o) => ({ tipo: "opcao" as const, o })),
    ...(onCriar && termo ? [{ tipo: "criar" as const }] : []),
  ];

  function digitar(v: string) {
    setQ(v);
    setAtivo(0);
    setAberto(true);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) {
      setOpcoes([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const n = ++ultima.current;
    timer.current = setTimeout(async () => {
      let r: RespostaBusca;
      try {
        r = await buscar(v);
      } catch {
        if (n === ultima.current) {
          setErro(FALHA_CONEXAO);
          setCarregando(false);
        }
        return;
      }
      if (n !== ultima.current) return; // resposta velha
      setCarregando(false);
      if (r.ok) {
        setOpcoes(r.opcoes);
        setErro(null);
      } else setErro(falhaDe(r, "buscar"));
    }, ESPERA_MS);
  }

  function escolher(i: number) {
    const l = linhas[i];
    if (!l) return;
    setAberto(false);
    if (l.tipo === "opcao") onEscolher(l.o);
    else onCriar?.(termo);
    setQ("");
    setOpcoes([]);
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setAtivo((a) => Math.min(a + 1, Math.max(linhas.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (aberto && linhas.length > 0) {
        e.preventDefault();
        escolher(ativo);
      }
    } else if (e.key === "Escape") {
      setAberto(false);
    }
  }

  const listaId = `${idBase}-lista`;
  const mostrar = aberto && termo !== "";

  return (
    <div className="relative">
      <label htmlFor={`${idBase}-input`} className="sr-only">
        {rotulo}
      </label>
      <Input
        id={`${idBase}-input`}
        role="combobox"
        aria-expanded={mostrar}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={mostrar && linhas[ativo] ? `${idBase}-op-${ativo}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={q}
        disabled={desabilitado}
        placeholder={placeholder}
        onChange={(e) => digitar(e.target.value)}
        onKeyDown={teclas}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 120)}
      />
      {mostrar ? (
        <ul id={listaId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border-strong bg-surface-strong p-1 shadow-lg">
          {linhas.map((l, i) => (
            <li
              key={l.tipo === "opcao" ? l.o.id : "__criar"}
              id={`${idBase}-op-${i}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(i);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm", i === ativo ? "bg-primary-soft text-foreground" : "text-fg-soft")}
            >
              {l.tipo === "opcao" ? (
                <>
                  <span className="truncate">{l.o.nome}</span>
                  {l.o.detalhe ? <span className="shrink-0 font-mono text-[11px] text-fg-mute">{l.o.detalhe}</span> : null}
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-3.5" aria-hidden /> {rotuloCriar} <b className="font-medium text-foreground">“{termo}”</b>
                </span>
              )}
            </li>
          ))}
          {linhas.length === 0 ? <li className="px-2 py-1.5 text-sm text-fg-faint">{carregando ? "buscando…" : "nada encontrado"}</li> : null}
        </ul>
      ) : null}
      <MensagemErro falha={erro} className="mt-1" />
    </div>
  );
}
