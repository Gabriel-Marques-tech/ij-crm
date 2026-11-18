"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ROTULO_AREA, ROTULO_CARGO } from "@/lib/auth/areas";
import type { GrupoPosicoes, OcupacaoDaConta, OpcaoPosicao } from "@/lib/auth/cadastro";
import { ROTULO_PAPEL } from "@/lib/auth/papeis";
import { adicionarPosicaoUsuarioAction, encerrarOcupacaoUsuarioAction } from "./actions";
import { CampoPosicao } from "./campo-posicao";

const fmtDia = (d: string) => d.split("-").reverse().join("/");

/**
 * Posição na IJ na edição de usuário (GAB-105): as ocupações abertas, encerrar (hoje) e
 * adicionar (início hoje). Cada botão grava na hora, pelos serviços do G&G e com a régua da
 * Gestão. Papel/área/cargo da conta não mudam sozinhos: a sugestão aparece para quem edita aplicar.
 */
export function PosicoesUsuario({
  usuarioId,
  ocupacoes,
  grupos,
  temAreaGG,
}: {
  usuarioId: string;
  ocupacoes: readonly OcupacaoDaConta[];
  grupos: readonly GrupoPosicoes[];
  temAreaGG: boolean;
}) {
  const [escolhida, setEscolhida] = useState<OpcaoPosicao | null>(null);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function rodar(chamar: () => Promise<{ erro?: string; ok?: true } | undefined>, depois: () => void) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      try {
        const r = await chamar();
        if (r?.erro) setErro(r.erro);
        else depois();
      } catch {
        setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
      }
    });
  }

  function adicionar() {
    if (!escolhida) return setErro("Escolha uma posição.");
    const o = escolhida;
    rodar(
      () => adicionarPosicaoUsuarioAction(usuarioId, o.id),
      () => {
        const s = o.sugestao;
        setAviso(
          `Posição atribuída. O organograma sugere: ${ROTULO_PAPEL[s.papel]}${s.area ? ` · ${ROTULO_AREA[s.area]}` : ""}${s.cargos.length ? ` · ${s.cargos.map((c) => ROTULO_CARGO[c]).join(", ")}` : ""}. Ajuste papel e cargo abaixo se quiser.`,
        );
        setEscolhida(null);
        setVersao((v) => v + 1);
      },
    );
  }

  function encerrar(o: OcupacaoDaConta) {
    if (!window.confirm(`Encerrar hoje a posição ${o.rotulo}?`)) return;
    rodar(() => encerrarOcupacaoUsuarioAction(usuarioId, o.ocupacaoId), () => setAviso(`Posição ${o.rotulo} encerrada.`));
  }

  return (
    <section aria-label="Posição na IJ" className="space-y-3 rounded-lg border border-border bg-muted p-3">
      <p className="eyebrow">posição na ij</p>
      {ocupacoes.length ? (
        <ul className="space-y-1.5 text-sm">
          {ocupacoes.map((o) => (
            <li key={o.ocupacaoId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                {o.rotulo}
                {o.principal ? <span className="ml-1.5 text-xs text-fg-mute">· principal</span> : null}
                <span className="block font-mono text-xs text-fg-faint">desde {o.inicio ? fmtDia(o.inicio) : "?"}</span>
              </span>
              <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => encerrar(o)}>
                Encerrar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-faint">Sem posição atual no organograma.</p>
      )}
      <CampoPosicao key={versao} name="novaPosicao" rotulo="Adicionar posição" vazio="Escolha a posição" grupos={grupos} temAreaGG={temAreaGG} onEscolher={setEscolhida} />
      <Button type="button" variant="outline" size="sm" disabled={pendente || !escolhida} onClick={adicionar}>
        Adicionar posição
      </Button>
      {aviso ? (
        <p role="status" className="text-xs text-fg-soft">
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      ) : null}
    </section>
  );
}
