"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import type { GrupoPosicoes, OpcaoPosicao } from "@/lib/auth/cadastro";
import { normalizar, pareceAreaGG } from "@/lib/gg/modelo";

const CLASSE_CAMPO =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

export const AVISO_SEM_AREA_GG =
  "Nenhuma área do organograma está marcada como Gente & Gestão. Quem ocupar uma posição de G&G não vai conseguir editar o G&G até um admin marcar a área (G&G → Estrutura).";

/** Acha a opção pelo id em todos os grupos. */
export function acharPosicao(grupos: readonly GrupoPosicoes[], id: string): OpcaoPosicao | undefined {
  for (const g of grupos) for (const o of g.opcoes) if (o.id === id) return o;
  return undefined;
}

/**
 * "Posição na IJ" (GAB-105): posições ativas do organograma, agrupadas por área ou frente, com
 * busca. Escolher avisa o pai (`onEscolher`), que pré-preenche papel, área e cargos.
 * `name` vai no FormData (vazio = sem posição). Sem área marcada `ehGG`, escolher ou procurar
 * uma posição de G&G mostra o aviso do pré-requisito.
 */
export function CampoPosicao({
  grupos,
  temAreaGG,
  name = "posicaoId",
  rotulo = "Posição na IJ (opcional)",
  vazio = "Sem posição",
  onEscolher,
}: {
  grupos: readonly GrupoPosicoes[];
  temAreaGG: boolean;
  name?: string;
  rotulo?: string;
  vazio?: string;
  onEscolher?: (opcao: OpcaoPosicao | null) => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhida, setEscolhida] = useState("");
  const termo = normalizar(busca);
  const filtrados = termo
    ? grupos
        .map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => o.id === escolhida || normalizar(`${g.rotulo} ${o.rotulo}`).includes(termo)) }))
        .filter((g) => g.opcoes.length > 0)
    : grupos;
  const opcao = escolhida ? acharPosicao(grupos, escolhida) : undefined;
  const avisoGG = !temAreaGG && ((opcao?.pareceGG ?? false) || (termo.length >= 2 && pareceAreaGG(busca)));
  const total = grupos.reduce((n, g) => n + g.opcoes.length, 0);

  function escolher(id: string) {
    setEscolhida(id);
    onEscolher?.(id ? (acharPosicao(grupos, id) ?? null) : null);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-select`}>{rotulo}</Label>
      {total > 0 ? (
        <input
          type="search"
          aria-label="Procurar posição"
          placeholder="Procurar área ou cargo…"
          value={busca}
          onChange={(e) => setBusca(e.currentTarget.value)}
          // Enter na busca não envia o cadastro.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          className={CLASSE_CAMPO}
        />
      ) : null}
      <select id={`${name}-select`} name={name} value={escolhida} onChange={(e) => escolher(e.currentTarget.value)} className={CLASSE_CAMPO} disabled={total === 0}>
        <option value="">{total === 0 ? "Nenhuma posição ativa no organograma" : vazio}</option>
        {filtrados.map((g) => (
          <optgroup key={g.rotulo} label={g.rotulo}>
            {g.opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {avisoGG ? (
        <p role="status" className="text-xs text-warn">
          {AVISO_SEM_AREA_GG}
        </p>
      ) : opcao?.ehGG ? (
        <p className="text-xs text-fg-faint">Posição de Gente & Gestão: a pessoa passa a editar o G&G.</p>
      ) : null}
    </div>
  );
}
