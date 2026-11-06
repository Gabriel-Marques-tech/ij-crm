import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CentralizarNaRaiz } from "./centralizar";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { MenuOcupacao } from "@/components/gg/acoes-ocupacao";
import { Chip, Painel } from "@/components/gg/ui";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { descendentes, ROTULO_CATEGORIA, ROTULO_STATUS_MEMBRO, vigente } from "@/lib/gg/modelo";
import { areasGG, carregarBase, ehEditorGG, postosDe, type BaseOrg, type PosicaoB } from "@/lib/gg/organizacao";

export const metadata = { title: "Organograma · G&G" };

/** Derivado das posições e das ocupações vigentes. `?escopo=gg` mostra só G&G; `?fechado=` guarda galhos recolhidos. */
export default async function OrganogramaPage({ searchParams }: { searchParams: Promise<{ escopo?: string; fechado?: string }> }) {
  const ator = await exigirUsuario();
  const { escopo, fechado } = await searchParams;
  const [base, editor] = await Promise.all([carregarBase(), ehEditorGG(ator)]);
  const so = escopo === "gg" ? areasGG(base.areas) : null;
  const posicoes = base.posicoes.filter((p) => !so || so.has(p.areaId));
  const raizes = posicoes.filter((p) => !p.liderancaId || !posicoes.some((x) => x.id === p.liderancaId));
  // Na IJ inteira, o ramo de G&G (o maior) começa recolhido; na aba Gente & Gestão, aberto.
  const gg = areasGG(base.areas);
  const raizGG = base.posicoes.find((p) => gg.has(p.areaId) && !gg.has(base.posicoes.find((x) => x.id === p.liderancaId)?.areaId ?? ""));
  const fechados = new Set((fechado ?? (escopo === "gg" ? "" : (raizGG?.id ?? ""))).split(",").filter(Boolean));
  const semPosicao = base.membros.filter((m) => m.status === "ATIVO" && !postosDe(base, m.id).length);
  const opcoesPosicao = base.posicoes.map((p) => ({ id: p.id, nome: p.nome }));
  const opcoesMembro = base.membros.filter((m) => m.status !== "INATIVO").map((m) => ({ id: m.id, nome: m.nome }));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · organograma" title="Organograma" description="Derivado das posições e das ocupações vigentes. O menu ⋯ concentra as ações da posição e de quem a ocupa." />
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Escopo" className="inline-flex rounded-lg border border-border-strong p-0.5 text-sm">
          {[
            ["", "Inteli Júnior"],
            ["gg", "Gente & Gestão"],
          ].map(([v, n]) => (
            <Link key={v} href={v ? `?escopo=${v}` : "?"} aria-current={(escopo ?? "") === v ? "page" : undefined} className={cn("rounded-md px-3 py-1", (escopo ?? "") === v ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
              {n}
            </Link>
          ))}
        </nav>
        <span className="font-mono text-xs text-fg-faint">{posicoes.length} posições · vínculos vigentes</span>
      </div>
      <section id="org-canvas" className="org-canvas overflow-auto rounded-xl border border-border bg-surface p-6">
        <CentralizarNaRaiz alvo="org-canvas" />
        <p className="eyebrow mb-8 flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          {escopo === "gg" ? "gente & gestão" : "inteli júnior"}
        </p>
        <ul className="org-tree">
          {raizes.map((p) => (
            <No key={p.id} p={p} base={base} posicoes={posicoes} fechados={fechados} escopo={escopo} editor={editor} opcoesPosicao={opcoesPosicao} opcoesMembro={opcoesMembro} />
          ))}
        </ul>
      </section>
      <p className="text-xs text-fg-faint">Posições sem liderança informada aparecem como raízes independentes. Uma pessoa pode ocupar mais de uma posição.</p>
      {semPosicao.length ? (
        <Painel titulo="Membros ativos sem posição" contagem={semPosicao.length}>
          <div className="flex flex-wrap gap-2 p-4">
            {semPosicao.map((m) => (
              <Link key={m.id} href={`/gg/membros/${m.id}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-strong py-0.5 pr-3 pl-0.5 text-sm hover:border-border-strong">
                <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
                {m.nome}
              </Link>
            ))}
          </div>
        </Painel>
      ) : null}
    </div>
  );
}

function No({ p, base, posicoes, fechados, escopo, editor, opcoesPosicao, opcoesMembro }: { p: PosicaoB; base: BaseOrg; posicoes: PosicaoB[]; fechados: Set<string>; escopo?: string; editor: boolean; opcoesPosicao: { id: string; nome: string }[]; opcoesMembro: { id: string; nome: string }[] }) {
  const filhos = posicoes.filter((x) => x.liderancaId === p.id);
  const area = base.areas.find((a) => a.id === p.areaId)!;
  const cargo = base.cargos.find((c) => c.id === p.cargoId)!;
  const ocupacoes = base.ocupacoes.filter((o) => o.posicaoId === p.id && vigente(o, base.hoje));
  const fechado = fechados.has(p.id);
  const frente = area.tipo === "FRENTE";
  return (
    <li>
      <article className={cn("relative z-[1] w-[235px] rounded-lg border p-3.5 text-left has-[details[open]]:z-30", filhos.length ? "border-primary/45 bg-primary-soft/40" : "border-border-strong bg-surface", ocupacoes.length ? "" : "border-dashed")}>
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <span className={cn("pt-1.5 font-mono text-[11px] tracking-wide", frente ? "text-chart-5" : "text-primary/80")}>{area.nome}</span>
          {editor ? (
            <MenuOcupacao
              posicao={{ id: p.id, nome: p.nome }}
              ocupantes={ocupacoes.map((o) => ({ ocupacaoId: o.id, nome: base.membros.find((m) => m.id === o.membroId)!.nome, principal: o.principal }))}
              posicoes={opcoesPosicao}
              membros={opcoesMembro}
              hoje={base.hoje}
            />
          ) : null}
        </div>
        <strong className="block text-sm font-medium leading-snug">{p.nome}</strong>
        <span className="text-xs text-fg-faint">
          {cargo.nome} · {ROTULO_CATEGORIA[cargo.categoria]}
        </span>
        {ocupacoes.length ? (
          ocupacoes.map((o, i) => {
            const m = base.membros.find((x) => x.id === o.membroId)!;
            return (
              <Link key={o.id} href={`/gg/membros/${m.id}`} className={cn("group flex items-center gap-2 border-t border-primary/20 text-[13.5px]", i === 0 ? "mt-3 pt-2.5" : "mt-2 pt-2")}>
                <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
                <span className="min-w-0 flex-1 truncate">{m.nome}</span>
                {m.status !== "ATIVO" ? <Chip tom="aviso">{ROTULO_STATUS_MEMBRO[m.status]}</Chip> : null}
                <ArrowUpRight className="size-3.5 shrink-0 text-fg-faint group-hover:text-foreground" />
              </Link>
            );
          })
        ) : (
          <p className="mt-3 border-t border-border pt-2.5 text-xs text-fg-faint">Posição sem ocupante</p>
        )}
        {filhos.length ? (
          <Link href={hrefAlternar(p.id, fechados, escopo)} scroll={false} aria-expanded={!fechado} className="mt-2.5 inline-block font-mono text-[11px] text-fg-faint hover:text-foreground">
            {fechado ? `▸ mostrar ${contarAbaixo(p.id, posicoes)} abaixo` : "▾ recolher"}
          </Link>
        ) : null}
      </article>
      {filhos.length && !fechado ? (
        <ul>
          {filhos.map((f) => (
            <No key={f.id} p={f} base={base} posicoes={posicoes} fechados={fechados} escopo={escopo} editor={editor} opcoesPosicao={opcoesPosicao} opcoesMembro={opcoesMembro} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function hrefAlternar(id: string, fechados: Set<string>, escopo?: string): string {
  const n = new Set(fechados);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  const q = new URLSearchParams();
  if (escopo) q.set("escopo", escopo);
  q.set("fechado", [...n].join(","));
  return `?${q}`;
}

function contarAbaixo(id: string, posicoes: PosicaoB[]): number {
  return descendentes(posicoes.map((p) => ({ id: p.id, superiorId: p.liderancaId })), id).size - 1;
}
