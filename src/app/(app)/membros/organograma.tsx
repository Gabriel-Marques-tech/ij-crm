import { Fragment } from "react";
import Link from "next/link";
import { ArrowUpRight, UserPlus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { MenuOcupacao } from "@/components/gg/acoes-ocupacao";
import { Chip, Painel } from "@/components/gg/ui";
import { cupula, descendentes, ROTULO_CATEGORIA, ROTULO_STATUS_MEMBRO, vigente } from "@/lib/gg/modelo";
import { HREF_MEMBROS, hrefMembros } from "@/lib/gg/membros";
import { areasGG, postosDe, type BaseOrg, type PosicaoB } from "@/lib/gg/organizacao";
import { CentralizarNaRaiz } from "./centralizar";

type Contexto = {
  base: BaseOrg;
  posicoes: PosicaoB[];
  fechados: Set<string>;
  escopo?: string;
  editor: boolean;
  cadastra: boolean;
  opcoesPosicao: { id: string; nome: string }[];
  opcoesMembro: { id: string; nome: string }[];
};

/**
 * Organograma (visão `organograma`), derivado das posições e das ocupações vigentes: cada cartão é
 * uma posição (área ou frente, cargo) com quem a ocupa; vaga aparece tracejada como "Vago".
 * Clicar na pessoa abre a ficha. Na vaga, quem cadastra (gestor/admin) abre o cadastro já na
 * posição (`?cadastrar=`); o editor de G&G tem o menu ⋯ da posição, como antes; os demais só leem.
 * A cúpula institucional (Presidência → Vice-Presidência) aparece lado a lado numa linha só, com as
 * diretorias abaixo das duas (`cupula`, só exibição: a hierarquia guardada não muda).
 * `?escopo=gg` mostra só G&G; `?fechado=` guarda os galhos recolhidos. HTML/CSS (`.org-tree`), sem
 * biblioteca de grafo; a árvore rola dentro do quadro, nunca a página.
 */
export function Organograma({ base, editor, cadastra, escopo, fechado }: { base: BaseOrg; editor: boolean; cadastra: boolean; escopo?: string; fechado?: string }) {
  const so = escopo === "gg" ? areasGG(base.areas) : null;
  const posicoes = base.posicoes.filter((p) => !so || so.has(p.areaId));
  const raizes = posicoes.filter((p) => !p.liderancaId || !posicoes.some((x) => x.id === p.liderancaId));
  // Na IJ inteira, o ramo de G&G (o maior) começa recolhido; no escopo Gente & Gestão, aberto.
  const gg = areasGG(base.areas);
  const raizGG = base.posicoes.find((p) => gg.has(p.areaId) && !gg.has(base.posicoes.find((x) => x.id === p.liderancaId)?.areaId ?? ""));
  const fechados = new Set((fechado ?? (escopo === "gg" ? "" : (raizGG?.id ?? ""))).split(",").filter(Boolean));
  const semPosicao = base.membros.filter((m) => m.status === "ATIVO" && !postosDe(base, m.id).length);
  const vagas = posicoes.filter((p) => !base.ocupacoes.some((o) => o.posicaoId === p.id && vigente(o, base.hoje))).length;
  const ctx: Contexto = {
    base,
    posicoes,
    fechados,
    escopo,
    editor,
    cadastra,
    opcoesPosicao: base.posicoes.map((p) => ({ id: p.id, nome: p.nome })),
    opcoesMembro: base.membros.filter((m) => m.status !== "INATIVO").map((m) => ({ id: m.id, nome: m.nome })),
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Escopo" className="inline-flex rounded-lg border border-border-strong p-0.5 text-sm">
          {[
            ["", "Inteli Júnior"],
            ["gg", "Gente & Gestão"],
          ].map(([v, n]) => (
            <Link
              key={v}
              href={hrefMembros({ visao: "organograma", escopo: v })}
              aria-current={(escopo ?? "") === v ? "page" : undefined}
              className={cn("rounded-md px-3 py-1", (escopo ?? "") === v ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}
            >
              {n}
            </Link>
          ))}
        </nav>
        <span className="font-mono text-xs text-fg-faint">
          {posicoes.length} posições · {vagas} vagas
        </span>
      </div>
      <section id="org-canvas" aria-label="Organograma" className="org-canvas max-h-[75vh] max-w-full overflow-auto overscroll-contain rounded-xl border border-border bg-surface p-4 md:p-6">
        <CentralizarNaRaiz alvo="org-canvas" />
        <p className="eyebrow sticky left-0 mb-8 flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          {escopo === "gg" ? "gente & gestão" : "inteli júnior"}
        </p>
        <ul className="org-tree">
          {raizes.map((p) => (
            <Raiz key={p.id} p={p} ctx={ctx} />
          ))}
        </ul>
      </section>
      <p className="text-xs text-fg-faint">
        Posições sem liderança informada aparecem como raízes independentes. Uma pessoa pode ocupar mais de uma posição.
        {cadastra ? " Clique numa vaga para cadastrar alguém nela." : ""}
      </p>
      {semPosicao.length ? (
        <Painel titulo="Membros ativos sem posição" contagem={semPosicao.length}>
          <div className="flex flex-wrap gap-2 p-4">
            {semPosicao.map((m) => (
              <Link key={m.id} href={`${HREF_MEMBROS}/${m.id}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-strong py-0.5 pr-3 pl-0.5 text-sm hover:border-border-strong">
                <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
                {m.nome}
              </Link>
            ))}
          </div>
        </Painel>
      ) : null}
    </>
  );
}

/** Raiz da árvore: se começa uma cúpula institucional, as posições dela dividem a mesma linha. */
function Raiz({ p, ctx }: { p: PosicaoB; ctx: Contexto }) {
  const { base, posicoes, fechados, escopo } = ctx;
  const institucional = new Set(base.areas.filter((a) => a.tipo === "INSTITUCIONAL").map((a) => a.id));
  const { ids, filhos: idsFilhos } = cupula(
    posicoes.map((x) => ({ id: x.id, superiorId: x.liderancaId, institucional: institucional.has(x.areaId) })),
    p.id,
  );
  if (ids.length === 1) return <No p={p} ctx={ctx} />;
  const linha = ids.map((id) => posicoes.find((x) => x.id === id)!);
  const filhos = idsFilhos.map((id) => posicoes.find((x) => x.id === id)!);
  // A linha recolhe como um galho só: basta um id dela em `?fechado=` (link antigo com a VP);
  // reabrir limpa todos. O total conta tudo abaixo da linha.
  const fechado = ids.some((id) => fechados.has(id));
  const abaixo = filhos.reduce((n, f) => n + contarAbaixo(f.id, posicoes) + 1, 0);
  const alternar = filhos.length ? { href: hrefAlternar(ids, fechados, escopo), fechado, abaixo } : null;
  return (
    <li>
      <div className={cn("org-cupula", filhos.length && !fechado && "org-cupula-desce")}>
        {linha.map((x, i) => (
          <Fragment key={x.id}>
            {i > 0 ? <span aria-hidden className="org-cupula-elo" /> : null}
            <Cartao p={x} ctx={ctx} temFilhos={filhos.length > 0} alternar={i === linha.length - 1 ? alternar : null} />
          </Fragment>
        ))}
      </div>
      {filhos.length && !fechado ? (
        <ul>
          {filhos.map((f) => (
            <No key={f.id} p={f} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function No({ p, ctx }: { p: PosicaoB; ctx: Contexto }) {
  const { posicoes, fechados, escopo } = ctx;
  const filhos = posicoes.filter((x) => x.liderancaId === p.id);
  const fechado = fechados.has(p.id);
  const alternar = filhos.length ? { href: hrefAlternar([p.id], fechados, escopo), fechado, abaixo: contarAbaixo(p.id, posicoes) } : null;
  return (
    <li>
      <Cartao p={p} ctx={ctx} temFilhos={filhos.length > 0} alternar={alternar} />
      {filhos.length && !fechado ? (
        <ul>
          {filhos.map((f) => (
            <No key={f.id} p={f} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Cartao({ p, ctx, temFilhos, alternar }: { p: PosicaoB; ctx: Contexto; temFilhos: boolean; alternar: { href: string; fechado: boolean; abaixo: number } | null }) {
  const { base, fechados, escopo, editor, cadastra } = ctx;
  // Área ou cargo desativado com a posição ainda ativa: o cartão avisa em vez de derrubar a página.
  const area = base.areas.find((a) => a.id === p.areaId);
  const cargo = base.cargos.find((c) => c.id === p.cargoId);
  const ocupacoes = base.ocupacoes.filter((o) => o.posicaoId === p.id && vigente(o, base.hoje));
  const frente = area?.tipo === "FRENTE";
  return (
    <article
      className={cn(
        "relative z-[1] w-[220px] rounded-lg border p-3 text-left has-[details[open]]:z-30 md:w-[235px] md:p-3.5",
        temFilhos ? "border-primary/45 bg-primary-soft/40" : "border-border-strong bg-surface",
        ocupacoes.length ? "" : "border-dashed",
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className={cn("pt-1.5 font-mono text-[11px] tracking-wide", frente ? "text-chart-5" : "text-primary/80")}>{area?.nome ?? "área inativa"}</span>
        {editor ? (
          <MenuOcupacao
            posicao={{ id: p.id, nome: p.nome }}
            ocupantes={ocupacoes.map((o) => ({ ocupacaoId: o.id, nome: base.membros.find((m) => m.id === o.membroId)?.nome ?? "?", principal: o.principal }))}
            posicoes={ctx.opcoesPosicao}
            membros={ctx.opcoesMembro}
            hoje={base.hoje}
          />
        ) : null}
      </div>
      <strong className="block text-sm font-medium leading-snug">{p.nome}</strong>
      <span className="text-xs text-fg-faint">
        {cargo ? `${cargo.nome} · ${ROTULO_CATEGORIA[cargo.categoria]}` : "cargo inativo"}
      </span>
      {ocupacoes.length ? (
        ocupacoes.map((o, i) => {
          const m = base.membros.find((x) => x.id === o.membroId)!;
          return (
            <Link key={o.id} href={`${HREF_MEMBROS}/${m.id}`} className={cn("group flex items-center gap-2 border-t border-primary/20 text-[13.5px]", i === 0 ? "mt-3 pt-2.5" : "mt-2 pt-2")}>
              <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-6 text-[9px]" />
              <span className="min-w-0 flex-1 truncate group-hover:underline">{m.nome}</span>
              {m.status !== "ATIVO" ? <Chip tom="aviso">{ROTULO_STATUS_MEMBRO[m.status]}</Chip> : null}
              <ArrowUpRight className="size-3.5 shrink-0 text-fg-faint group-hover:text-foreground" />
            </Link>
          );
        })
      ) : cadastra ? (
        <Link
          href={hrefMembros({ visao: "organograma", escopo, fechado: [...fechados].join(","), cadastrar: p.id })}
          scroll={false}
          aria-label={`Vago: cadastrar pessoa em ${p.nome}`}
          className="group mt-3 flex items-center gap-2 border-t border-border pt-2.5 text-xs text-fg-faint hover:text-primary"
        >
          <span className="flex-1">Vago</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-1.5 py-0.5 group-hover:border-primary/60">
            <UserPlus className="size-3.5" /> cadastrar
          </span>
        </Link>
      ) : (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-fg-faint">Vago</p>
      )}
      {alternar ? (
        <Link href={alternar.href} scroll={false} aria-expanded={!alternar.fechado} className="mt-2.5 inline-block font-mono text-[11px] text-fg-faint hover:text-foreground">
          {alternar.fechado ? `▸ mostrar ${alternar.abaixo} abaixo` : "▾ recolher"}
        </Link>
      ) : null}
    </article>
  );
}

/** Alterna o galho de `ids` (um nó, ou a linha da cúpula pela raiz `ids[0]`): recolhido → tira todos; aberto → recolhe pela raiz. */
function hrefAlternar(ids: string[], fechados: Set<string>, escopo?: string): string {
  const n = new Set(fechados);
  if (ids.some((id) => n.has(id))) for (const id of ids) n.delete(id);
  else n.add(ids[0]);
  // `fechado` vazio ainda vai na URL: diz "nenhum recolhido", diferente de "o padrão" (G&G recolhido).
  const q = new URLSearchParams({ visao: "organograma" });
  if (escopo) q.set("escopo", escopo);
  q.set("fechado", [...n].join(","));
  return `${HREF_MEMBROS}?${q}`;
}

function contarAbaixo(id: string, posicoes: PosicaoB[]): number {
  return descendentes(posicoes.map((p) => ({ id: p.id, superiorId: p.liderancaId })), id).size - 1;
}
