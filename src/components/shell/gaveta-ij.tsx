"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "cn";
import type { Area } from "@prisma/client";
import { SimboloIJ } from "@/components/marca/marca";
import { AREAS, ladoDe, ROTULO_AREA } from "@/lib/auth/areas";
import { destinoDaArea } from "@/lib/auth/visibilidade";
import { useNavegacaoArea } from "./area-atual";
import { ehRotaGG, HREF_GG, isActive, itensDaGaveta } from "./nav-config";

/** Cor de cada área, para o indicador e a gaveta. Vendas no coral da marca; Projetos no azul da paleta. */
const COR_DA_AREA: Record<Area, { ponto: string; texto: string; borda: string }> = {
  VENDAS: { ponto: "bg-primary", texto: "text-primary", borda: "border-primary/40" },
  PROJETOS: { ponto: "bg-chart-4", texto: "text-chart-4", borda: "border-chart-4/40" },
};

/** Gente & Gestão: área do hub sem lado no CRM (ver `ITENS_GG`). */
const COR_GG = { ponto: "bg-chart-5", texto: "text-chart-5", borda: "border-chart-5/40" };

/** O ícone da IJ: abre a gaveta, não navega (§4.1). */
export function BotaoGaveta({ tamanho, className }: { tamanho: number; className?: string }) {
  const { abrirGaveta, gavetaAberta } = useNavegacaoArea();
  return (
    <button
      type="button"
      aria-label="Abrir menu de áreas"
      aria-haspopup="dialog"
      aria-expanded={gavetaAberta}
      title="Áreas e geral"
      onClick={(e) => abrirGaveta(e.currentTarget)}
      className={className}
    >
      <SimboloIJ tamanho={tamanho} />
    </button>
  );
}

/** Em que área a pessoa está: no rail, abaixo do ícone; no mobile, na topbar. */
export function IndicadorArea({ className }: { className?: string }) {
  const { area } = useNavegacaoArea();
  const gg = ehRotaGG(usePathname());
  const cor = gg ? COR_GG : COR_DA_AREA[area];
  return (
    <p
      className={cn("flex items-center justify-center gap-1.5 rounded-md border px-1.5 py-1 text-[10px] font-medium uppercase tracking-eyebrow", cor.borda, cor.texto, className)}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", cor.ponto)} />
      <span className="sr-only">Área atual: </span>
      {gg ? "G&G" : ROTULO_AREA[area]}
    </p>
  );
}

const CLASSE_LINHA = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring";
const CLASSE_LINHA_ATIVA = "bg-primary-soft text-primary";
const CLASSE_LINHA_NORMAL = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground";

/**
 * Hub da IJ (§4.1): só abre pelo ícone; Esc, clique fora ou escolher um item fecham.
 * O Dialog cuida de prender o foco, do Esc e do aria; ao fechar, o foco volta ao ícone.
 */
export function GavetaIJ() {
  const { pessoa, inicio, area, gavetaAberta, fecharGaveta, gatilhoGaveta, escolherArea } = useNavegacaoArea();
  const pathname = usePathname();
  const primeiraArea = useRef<HTMLAnchorElement>(null);
  const lado = ladoDe(pessoa);

  return (
    <Dialog.Root open={gavetaAberta} onOpenChange={(aberta) => !aberta && fecharGaveta()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          initialFocus={primeiraArea}
          finalFocus={gatilhoGaveta}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 shadow-lg transition duration-150 ease-out outline-none data-ending-style:-translate-x-4 data-ending-style:opacity-0 data-starting-style:-translate-x-4 data-starting-style:opacity-0 md:left-[88px]"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-medium text-foreground">Inteli Júnior</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="rounded-md p-1 text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <nav aria-label="Áreas" className="space-y-1">
            <p className="eyebrow mb-2 px-3">áreas</p>
            {AREAS.map((a, i) => (
              <Link
                key={a}
                ref={i === 0 ? primeiraArea : undefined}
                href={destinoDaArea(pessoa, a, inicio)}
                onClick={() => escolherArea(a)}
                aria-current={a === area && !ehRotaGG(pathname) ? "true" : undefined}
                className={cn(CLASSE_LINHA, a === area && !ehRotaGG(pathname) ? CLASSE_LINHA_ATIVA : CLASSE_LINHA_NORMAL)}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", COR_DA_AREA[a].ponto)} />
                <span className="flex-1">{ROTULO_AREA[a]}</span>
                {a === lado ? <span className="rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-fg-soft">sua área</span> : null}
              </Link>
            ))}
            <Link
              href={HREF_GG}
              onClick={fecharGaveta}
              aria-current={ehRotaGG(pathname) ? "true" : undefined}
              className={cn(CLASSE_LINHA, ehRotaGG(pathname) ? CLASSE_LINHA_ATIVA : CLASSE_LINHA_NORMAL)}
            >
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", COR_GG.ponto)} />
              <span className="flex-1">Gente &amp; Gestão</span>
            </Link>
          </nav>

          <nav aria-label="Geral" className="space-y-1">
            <p className="eyebrow mb-2 px-3">geral</p>
            {itensDaGaveta(pessoa).map((item) => {
              const ativo = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={fecharGaveta}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(CLASSE_LINHA, ativo ? CLASSE_LINHA_ATIVA : CLASSE_LINHA_NORMAL)}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={ativo ? 2.25 : 1.75} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
