"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ROTULO_AREA, ROTULO_CARGO } from "@/lib/auth/areas";
import type { AreaPosicoes, OcupacaoDaConta, OpcaoPosicao } from "@/lib/auth/cadastro";
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
  areas,
  temAreaGG,
}: {
  usuarioId: string;
  ocupacoes: readonly OcupacaoDaConta[];
  areas: readonly AreaPosicoes[];
  temAreaGG: boolean;
}) {
  const [escolhida, setEscolhida] = useState<OpcaoPosicao | null>(null);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  // Homônimo sem e-mail no G&G (só quando a conta ainda não tem membro): pergunta antes de criar outro.
  const [homonimo, setHomonimo] = useState<{ membros: { id: string; nome: string }[]; posicao: OpcaoPosicao } | null>(null);

  function rodar(chamar: () => Promise<{ erro?: string; ok?: true; homonimos?: { id: string; nome: string }[] } | undefined>, depois: () => void, posicao?: OpcaoPosicao) {
    setErro(null);
    setAviso(null);
    setHomonimo(null);
    startTransition(async () => {
      try {
        const r = await chamar();
        if (r?.homonimos?.length && posicao) setHomonimo({ membros: r.homonimos, posicao });
        else if (r?.erro) setErro(r.erro);
        else depois();
      } catch {
        setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
      }
    });
  }

  function adicionar(o: OpcaoPosicao | null = escolhida, confirmacao: { ligarMembroId?: string; criarMembroNovo?: boolean } = {}) {
    if (!o) return setErro("Escolha uma posição.");
    rodar(
      () => adicionarPosicaoUsuarioAction(usuarioId, o.id, confirmacao),
      () => {
        const s = o.sugestao;
        setAviso(
          `Posição atribuída. O organograma sugere: ${ROTULO_PAPEL[s.papel]}${s.area ? ` · ${ROTULO_AREA[s.area]}` : ""}${s.cargos.length ? ` · ${s.cargos.map((c) => ROTULO_CARGO[c]).join(", ")}` : ""}. Ajuste papel e cargo abaixo se quiser.`,
        );
        setEscolhida(null);
        setVersao((v) => v + 1);
      },
      o,
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
      <CampoPosicao key={versao} name="novaPosicao" rotulo="Adicionar posição" areas={areas} temAreaGG={temAreaGG} onEscolher={setEscolhida} />
      <Button type="button" variant="outline" size="sm" disabled={pendente || !escolhida} onClick={() => adicionar()}>
        Adicionar posição
      </Button>
      {homonimo ? (
        <div role="alert" className="space-y-2 rounded-lg border border-warn/50 bg-surface p-3 text-sm">
          <p>
            {homonimo.membros.length === 1 ? (
              <>
                Já existe <strong>&quot;{homonimo.membros[0].nome}&quot;</strong> sem e-mail no G&G. Ligar a ele?
              </>
            ) : (
              <>Há {homonimo.membros.length} membros sem e-mail no G&G com esse nome. É algum deles?</>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {homonimo.membros.map((h, i) => (
              <Button key={h.id} type="button" size="sm" disabled={pendente} onClick={() => adicionar(homonimo.posicao, { ligarMembroId: h.id })}>
                {homonimo.membros.length === 1 ? "Ligar a ele" : `Ligar a "${h.nome}" (${i + 1})`}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => adicionar(homonimo.posicao, { criarMembroNovo: true })}>
              É outra pessoa: criar membro novo
            </Button>
          </div>
        </div>
      ) : null}
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
