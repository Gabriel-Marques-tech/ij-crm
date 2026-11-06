"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "cn";

/**
 * Popover mínimo (sem dependência nova): ancorado num elemento, fecha com Esc
 * ou clique fora, reposiciona para caber na janela. Usado pelos menus de
 * filtro, propriedades e Exibição.
 */
export function Popover({ ancora, onFechar, children, className, rotulo }: { ancora: HTMLElement | null; onFechar: () => void; children: ReactNode; className?: string; rotulo: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!ancora || !ref.current) return;
    const r = ancora.getBoundingClientRect();
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = r.left;
    let top = r.bottom + 4;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 4 - h);
    setPos({ left, top });
  }, [ancora]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !ancora?.contains(e.target as Node)) onFechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onFechar();
      }
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [ancora, onFechar]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={rotulo}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      className={cn("fixed z-50 flex min-w-56 max-w-80 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/40", className)}
    >
      {children}
    </div>
  );
}

export type Opcao = { valor: string; rotulo: string; icone?: ReactNode; desabilitada?: boolean; atalho?: string };

/**
 * Lista de opções com busca opcional, setas e Enter. `multi` alterna sem
 * fechar; simples escolhe e fecha. Opção `livre` (texto que não existe) vira
 * "Criar “x”" — usado nas etiquetas.
 */
export function MenuOpcoes({
  ancora,
  titulo,
  opcoes,
  selecionadas = [],
  multi = false,
  busca = true,
  livre = false,
  onEscolher,
  onFechar,
}: {
  ancora: HTMLElement | null;
  titulo: string;
  opcoes: Opcao[];
  selecionadas?: string[];
  multi?: boolean;
  busca?: boolean;
  livre?: boolean;
  onEscolher: (valor: string) => void;
  onFechar: () => void;
}) {
  const [q, setQ] = useState("");
  const [foco, setFoco] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const termo = q.trim().toLowerCase();
  const visiveis = opcoes.filter((o) => !termo || o.rotulo.toLowerCase().includes(termo));
  const criar = livre && termo && !opcoes.some((o) => o.rotulo.toLowerCase() === termo) ? termo : null;
  const total = visiveis.length + (criar ? 1 : 0);
  const escolher = (i: number) => {
    if (i < visiveis.length) onEscolher(visiveis[i].valor);
    else if (criar) onEscolher(criar);
    if (!multi) onFechar();
    else setQ("");
  };
  return (
    <Popover ancora={ancora} onFechar={onFechar} rotulo={titulo}>
      {busca || livre ? (
        <label className="mb-1 flex h-8 items-center gap-2 border-b border-border px-2 text-fg-mute">
          <Search className="size-3.5" />
          <span className="sr-only">{titulo}</span>
          <input
            ref={inputRef}
            value={q}
            placeholder={titulo}
            onChange={(e) => {
              setQ(e.target.value);
              setFoco(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setFoco((f) => (f + 1) % Math.max(total, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFoco((f) => (f - 1 + Math.max(total, 1)) % Math.max(total, 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (total) escolher(foco);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-fg-faint"
          />
        </label>
      ) : (
        <p className="eyebrow px-2 pt-1.5 pb-1">{titulo}</p>
      )}
      <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {visiveis.map((o, i) => {
          const marcada = selecionadas.includes(o.valor);
          return (
            <button
              key={o.valor}
              type="button"
              role={multi ? "menuitemcheckbox" : "menuitem"}
              aria-checked={multi ? marcada : undefined}
              disabled={o.desabilitada}
              onMouseEnter={() => setFoco(i)}
              onClick={() => escolher(i)}
              className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground disabled:opacity-50", i === foco ? "bg-surface-hover" : "hover:bg-surface-hover")}
            >
              {o.icone}
              <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
              {o.atalho ? <kbd className="rounded bg-surface-strong px-1 font-mono text-[10px] text-fg-mute">{o.atalho}</kbd> : null}
              <Check className={cn("size-3.5 text-primary", marcada ? "visible" : "invisible")} />
            </button>
          );
        })}
        {criar ? (
          <button type="button" onMouseEnter={() => setFoco(visiveis.length)} onClick={() => escolher(visiveis.length)} className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm", foco === visiveis.length ? "bg-surface-hover" : "hover:bg-surface-hover")}>
            Criar “{criar}”
          </button>
        ) : null}
        {total === 0 ? <p className="px-2 py-1.5 text-xs text-fg-faint">Nada encontrado.</p> : null}
      </div>
    </Popover>
  );
}
