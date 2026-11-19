"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { AreaPosicoes, ContaAConfirmar, OcupacaoDaConta, OpcaoPosicao } from "@/lib/auth/cadastro";
import { adicionarPosicaoUsuarioAction, encerrarOcupacaoUsuarioAction, type EstadoPosicao } from "./actions";
import { CampoPosicao } from "./campo-posicao";
import { ConfirmarConta } from "./confirmar-conta";

const fmtDia = (d: string) => d.split("-").reverse().join("/");

/**
 * Posição na IJ na edição de usuário (GAB-105): as ocupações abertas, encerrar (hoje) e
 * adicionar (início hoje). Cada botão grava na hora, pelos serviços do G&G e com a régua da
 * Gestão. GAB-107: a conta acompanha as posições (o servidor recalcula na mesma gravação) e a tela
 * mostra como ficou; se o papel muda, o servidor pede confirmação e só grava com ela.
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
  // Mudança de papel pela posição: mostra a conta resultante e refaz a mesma operação com a confirmação.
  const [confirmacao, setConfirmacao] = useState<{ pedido: ContaAConfirmar; refazer: (conta: string) => void } | null>(null);

  function rodar(chamar: () => Promise<EstadoPosicao>, depois: (conta?: string) => void, refazer: (conta: string) => void, posicao?: OpcaoPosicao) {
    setErro(null);
    setAviso(null);
    setHomonimo(null);
    setConfirmacao(null);
    startTransition(async () => {
      try {
        const r = await chamar();
        if (r?.homonimos?.length && posicao) setHomonimo({ membros: r.homonimos, posicao });
        else if (r?.confirmarConta) setConfirmacao({ pedido: r.confirmarConta, refazer });
        else if (r?.erro) setErro(r.erro);
        else depois(r?.conta);
      } catch {
        setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
      }
    });
  }

  const comConta = (texto: string, conta?: string) => (conta ? `${texto} Conta no CRM: ${conta}.` : texto);

  function adicionar(o: OpcaoPosicao | null = escolhida, opcoes: { ligarMembroId?: string; criarMembroNovo?: boolean; confirmarConta?: string } = {}) {
    if (!o) return setErro("Escolha uma posição.");
    rodar(
      () => adicionarPosicaoUsuarioAction(usuarioId, o.id, opcoes),
      (conta) => {
        setAviso(comConta("Posição atribuída.", conta));
        setEscolhida(null);
        setVersao((v) => v + 1);
      },
      (conta) => adicionar(o, { ...opcoes, confirmarConta: conta }),
      o,
    );
  }

  function encerrar(o: OcupacaoDaConta, confirmarConta?: string) {
    if (!confirmarConta && !window.confirm(`Encerrar hoje a posição ${o.rotulo}?`)) return;
    rodar(
      () => encerrarOcupacaoUsuarioAction(usuarioId, o.ocupacaoId, confirmarConta ?? null),
      (conta) => setAviso(comConta(`Posição ${o.rotulo} encerrada.`, conta)),
      (conta) => encerrar(o, conta),
    );
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
      {confirmacao ? (
        <ConfirmarConta
          pedido={confirmacao.pedido}
          pendente={pendente}
          rotuloAtual="Hoje a conta é"
          onConfirmar={() => confirmacao.refazer(confirmacao.pedido.conta)}
          onCancelar={() => setConfirmacao(null)}
        />
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
