"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import type { AreaPosicoes, NoPosicoes, OpcaoPosicao } from "@/lib/auth/cadastro";

const CLASSE_CAMPO =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

export const AVISO_SEM_AREA_GG =
  "Nenhuma área do organograma está marcada como Gente & Gestão. Quem ocupar uma posição de G&G não vai conseguir editar o G&G até um admin marcar a área (G&G → Estrutura).";

/** "" no select de frente = as posições direto na área. */
const PROPRIA_AREA = "";

/**
 * "Posição na IJ" em cascata (GAB-105): Área de topo → Subárea/frente (só se a área tiver
 * frentes; "A própria área" para as posições direto nela) → Cargo (as posições ativas do nó; se
 * só houver uma, já vem escolhida). Trocar a área limpa frente e cargo; trocar a frente limpa o
 * cargo. O formulário recebe só o id da posição (`name`, hidden; vazio = sem posição) e o pai é
 * avisado a cada mudança (`onEscolher`), para pré-preencher papel, área e cargos do CRM.
 * Sem área marcada `ehGG`, escolher uma área que parece de G&G mostra o aviso do pré-requisito.
 */
export function CampoPosicao({
  areas,
  temAreaGG,
  name = "posicaoId",
  rotulo = "Posição na IJ (opcional)",
  onEscolher,
}: {
  areas: readonly AreaPosicoes[];
  temAreaGG: boolean;
  name?: string;
  rotulo?: string;
  onEscolher?: (opcao: OpcaoPosicao | null) => void;
}) {
  const [areaId, setAreaId] = useState("");
  const [frenteId, setFrenteId] = useState(PROPRIA_AREA);
  const [posicaoId, setPosicaoId] = useState("");

  const area = areas.find((a) => a.id === areaId);
  const temFrentes = (area?.frentes.length ?? 0) > 0;
  const no: NoPosicoes | undefined = area ? (frenteId ? area.frentes.find((f) => f.id === frenteId) : area) : undefined;
  const cargos = no?.posicoes ?? [];
  const escolhida = cargos.find((p) => p.id === posicaoId);
  const avisoGG = !temAreaGG && (area?.pareceGG ?? false);

  function escolherPosicao(p: OpcaoPosicao | undefined) {
    setPosicaoId(p?.id ?? "");
    onEscolher?.(p ?? null);
  }

  /** Cargo único no nó: já vem escolhido. */
  const unica = (n: NoPosicoes | undefined) => (n && n.posicoes.length === 1 ? n.posicoes[0] : undefined);

  function trocarArea(id: string) {
    const a = areas.find((x) => x.id === id);
    setAreaId(id);
    setFrenteId(PROPRIA_AREA);
    escolherPosicao(unica(a));
  }

  function trocarFrente(id: string) {
    setFrenteId(id);
    escolherPosicao(unica(id ? area?.frentes.find((f) => f.id === id) : area));
  }

  const idBase = `${name}-cascata`;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{rotulo}</legend>
      <input type="hidden" name={name} value={escolhida?.id ?? ""} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-area`}>Área da IJ</Label>
          <select id={`${idBase}-area`} value={areaId} onChange={(e) => trocarArea(e.currentTarget.value)} className={CLASSE_CAMPO} disabled={areas.length === 0}>
            <option value="">{areas.length === 0 ? "Organograma sem posições" : "Sem posição"}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        {area && temFrentes ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-frente`}>Subárea ou frente</Label>
            <select id={`${idBase}-frente`} value={frenteId} onChange={(e) => trocarFrente(e.currentTarget.value)} className={CLASSE_CAMPO}>
              <option value={PROPRIA_AREA}>{area.posicoes.length ? "A própria área" : "Escolha a frente"}</option>
              {area.frentes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {area && cargos.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-cargo`}>Cargo na IJ</Label>
            <select id={`${idBase}-cargo`} value={posicaoId} onChange={(e) => escolherPosicao(cargos.find((p) => p.id === e.currentTarget.value))} className={CLASSE_CAMPO}>
              {cargos.length > 1 ? <option value="">Escolha o cargo</option> : null}
              {cargos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.cargo}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {avisoGG ? (
        <p role="status" className="text-xs text-warn">
          {AVISO_SEM_AREA_GG}
        </p>
      ) : escolhida?.ehGG ? (
        <p className="text-xs text-fg-faint">Posição de Gente & Gestão: a pessoa passa a editar o G&G.</p>
      ) : null}
    </fieldset>
  );
}
