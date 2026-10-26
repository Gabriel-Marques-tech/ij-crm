"use client";

/**
 * Filtros da Tabela: mesmo padrão do Kanban (botão "Filtros" → painel lateral
 * + chips dos ativos + "Limpar filtros"). A diferença é que aqui o filtro roda
 * no servidor: mudar um filtro troca a URL (`router.replace`) e a página
 * re-renderiza com os dados novos, voltando para a página 1.
 */
import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatarDia } from "@/lib/oportunidades/formatar";
import {
  FILTROS_TABELA_VAZIOS,
  OPCOES_ACAO,
  OPCOES_ORIGEM,
  contarAtivosTabela,
  escreverEstado,
  type FiltrosTabela,
  type OrdemTabela,
  type SimNao,
} from "@/lib/tabela/params";

export type PipelineOpcao = { chave: string; nome: string; fases: { id: string; nome: string }[] };
export type PessoaOpcao = { id: string; nome: string; ativo: boolean };

type Props = {
  filtros: FiltrosTabela;
  ordem: OrdemTabela;
  pipelines: PipelineOpcao[];
  pessoas: PessoaOpcao[];
  meuId: string;
  total: number;
};

const ATRASO_BUSCA_MS = 300;

function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

export function BarraFiltrosTabela(props: Props) {
  const { filtros, ordem, pipelines, pessoas, total } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendente, iniciar] = useTransition();

  const mudar = useCallback(
    (f: FiltrosTabela) => {
      const qs = escreverEstado({ filtros: f, ordem, pagina: 1 }, new URLSearchParams(searchParams.toString())).toString();
      iniciar(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [ordem, pathname, router, searchParams],
  );

  const ativos = contarAtivosTabela(filtros);
  const fases = new Map(pipelines.flatMap((p) => p.fases.map((f) => [f.id, `${p.nome} · ${f.nome}`] as const)));
  const nomeDe = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? "Usuário removido";
  const rotulo = <T,>(ops: { valor: T; rotulo: string }[], v: T) => ops.find((o) => o.valor === v)?.rotulo ?? String(v);

  const chips: { chave: string; texto: string; remover: () => void }[] = [
    ...filtros.quadro.map((c) => ({ chave: `quadro:${c}`, texto: pipelines.find((p) => p.chave === c)?.nome ?? c, remover: () => mudar({ ...filtros, quadro: alternar(filtros.quadro, c) }) })),
    ...filtros.fase.map((id) => ({ chave: `fase:${id}`, texto: fases.get(id) ?? "Fase arquivada", remover: () => mudar({ ...filtros, fase: alternar(filtros.fase, id) }) })),
    ...filtros.resp.map((id) => ({ chave: `resp:${id}`, texto: nomeDe(id), remover: () => mudar({ ...filtros, resp: alternar(filtros.resp, id) }) })),
    ...(filtros.q ? [{ chave: "q", texto: `“${filtros.q}”`, remover: () => mudar({ ...filtros, q: "" }) }] : []),
    ...(filtros.revisar ? [{ chave: "revisar", texto: filtros.revisar === "sim" ? "Revisar" : "Sem revisar", remover: () => mudar({ ...filtros, revisar: null }) }] : []),
    ...(filtros.terminais
      ? [{ chave: "terminais", texto: filtros.terminais === "sim" ? "Só ganhos/perdidos" : "Só abertos", remover: () => mudar({ ...filtros, terminais: null }) }]
      : []),
    ...filtros.acao.map((v) => ({ chave: `acao:${v}`, texto: `Ação: ${rotulo(OPCOES_ACAO, v)}`, remover: () => mudar({ ...filtros, acao: alternar(filtros.acao, v) }) })),
    ...filtros.origem.map((v) => ({ chave: `origem:${v}`, texto: rotulo(OPCOES_ORIGEM, v), remover: () => mudar({ ...filtros, origem: alternar(filtros.origem, v) }) })),
    ...(filtros.de ? [{ chave: "de", texto: `Criado desde ${formatarDia(filtros.de)}`, remover: () => mudar({ ...filtros, de: null }) }] : []),
    ...(filtros.ate ? [{ chave: "ate", texto: `Criado até ${formatarDia(filtros.ate)}`, remover: () => mudar({ ...filtros, ate: null }) }] : []),
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <PainelFiltros {...props} ativos={ativos} mudar={mudar} />
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
        <Button variant="ghost" size="sm" onClick={() => mudar(FILTROS_TABELA_VAZIOS)}>
          Limpar filtros
        </Button>
      ) : null}
      <span className={cn("font-mono text-xs text-fg-faint tabular", pendente && "animate-pulse")} aria-live="polite">
        {pendente ? "atualizando…" : `${total} oportunidade(s)`}
      </span>
    </div>
  );
}

function PainelFiltros({ filtros, pipelines, pessoas, meuId, total, ativos, mudar }: Props & { ativos: number; mudar: (f: FiltrosTabela) => void }) {
  // Busca com atraso: digita local, aplica na URL depois de uma pausa.
  const [busca, setBusca] = useState(filtros.q);
  const [qAplicado, setQAplicado] = useState(filtros.q);
  const [enviado, setEnviado] = useState(filtros.q);
  if (qAplicado !== filtros.q) {
    setQAplicado(filtros.q);
    // Só acompanha mudança que veio de fora (chip removido, "Limpar").
    if (filtros.q !== enviado) setBusca(filtros.q);
  }
  useEffect(() => {
    const q = busca.trim();
    if (q === filtros.q) return;
    const t = setTimeout(() => {
      setEnviado(q);
      mudar({ ...filtros, q });
    }, ATRASO_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca, filtros, mudar]);

  const soEu = filtros.resp.length === 1 && filtros.resp[0] === meuId;
  // Fases só dos pipelines escolhidos (ou de todos, se nenhum).
  const pipesDeFase = filtros.quadro.length ? pipelines.filter((p) => filtros.quadro.includes(p.chave)) : pipelines;

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
          <SheetDescription>Aplicados na hora. O link da página guarda os filtros (e o CSV também os respeita).</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Grupo titulo="Busca">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Título, empresa ou contato" aria-label="Buscar por título, empresa ou contato" maxLength={100} />
          </Grupo>

          <Grupo titulo="Pipeline">
            <Opcoes
              ops={pipelines.map((p) => ({ valor: p.chave, rotulo: p.nome }))}
              marcados={filtros.quadro}
              onAlternar={(v) => mudar({ ...filtros, quadro: alternar(filtros.quadro, v) })}
            />
          </Grupo>

          <Grupo titulo="Fase">
            <div className="space-y-3">
              {pipesDeFase.map((p) => (
                <div key={p.chave}>
                  {pipesDeFase.length > 1 ? <p className="mb-1.5 font-mono text-[10px] text-fg-faint uppercase">{p.nome}</p> : null}
                  <Opcoes
                    ops={p.fases.map((f) => ({ valor: f.id, rotulo: f.nome }))}
                    marcados={filtros.fase}
                    onAlternar={(v) => mudar({ ...filtros, fase: alternar(filtros.fase, v) })}
                  />
                </div>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Situação">
            <TresVias valor={filtros.terminais} rotulos={["Todos", "Só ganhos/perdidos", "Só abertos"]} onMudar={(v) => mudar({ ...filtros, terminais: v })} />
          </Grupo>

          <Grupo titulo="Responsável">
            <Opcao ativo={soEu} onClick={() => mudar({ ...filtros, resp: soEu ? [] : [meuId] })} className="mb-2">
              Meus cards
            </Opcao>
            <ul className="space-y-1">
              {pessoas.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-hover">
                    <Checkbox checked={filtros.resp.includes(p.id)} onCheckedChange={() => mudar({ ...filtros, resp: alternar(filtros.resp, p.id) })} />
                    <span className={cn("truncate", !p.ativo && "text-fg-mute")}>{p.nome}</span>
                    {p.id === meuId ? <span className="font-mono text-[10px] text-fg-faint">você</span> : null}
                    {!p.ativo ? <span className="font-mono text-[10px] text-fg-faint">inativo</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </Grupo>

          <Grupo titulo="Revisar">
            <TresVias valor={filtros.revisar} rotulos={["Todos", "Sim", "Não"]} onMudar={(v) => mudar({ ...filtros, revisar: v })} />
          </Grupo>

          <Grupo titulo="Próxima ação">
            <Opcoes ops={OPCOES_ACAO} marcados={filtros.acao} onAlternar={(v) => mudar({ ...filtros, acao: alternar(filtros.acao, v) })} />
          </Grupo>

          <Grupo titulo="Origem">
            <Opcoes ops={OPCOES_ORIGEM} marcados={filtros.origem} onAlternar={(v) => mudar({ ...filtros, origem: alternar(filtros.origem, v) })} />
          </Grupo>

          <Grupo titulo="Criado em">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-fg-mute">
                <span>De</span>
                <Input type="date" className="font-mono" value={filtros.de ?? ""} max={filtros.ate ?? undefined} onChange={(e) => mudar({ ...filtros, de: e.target.value || null })} />
              </label>
              <label className="space-y-1 text-xs text-fg-mute">
                <span>Até</span>
                <Input type="date" className="font-mono" value={filtros.ate ?? ""} min={filtros.de ?? undefined} onChange={(e) => mudar({ ...filtros, ate: e.target.value || null })} />
              </label>
            </div>
          </Grupo>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <Button variant="ghost" size="sm" disabled={ativos === 0} onClick={() => mudar(FILTROS_TABELA_VAZIOS)}>
            Limpar filtros
          </Button>
          <span className="font-mono text-xs text-fg-faint tabular">{total} oportunidade(s)</span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TresVias({ valor, rotulos, onMudar }: { valor: SimNao | null; rotulos: [string, string, string]; onMudar: (v: SimNao | null) => void }) {
  const ops: [SimNao | null, string][] = [
    [null, rotulos[0]],
    ["sim", rotulos[1]],
    ["nao", rotulos[2]],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {ops.map(([v, r]) => (
        <Opcao key={r} ativo={valor === v} onClick={() => onMudar(v)}>
          {r}
        </Opcao>
      ))}
    </div>
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
