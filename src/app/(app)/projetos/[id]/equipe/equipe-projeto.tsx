"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FuncaoProjeto } from "@prisma/client";
import { Avatar } from "@/components/avatar";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { CAMPO, Chip, Painel, Tabela, diaBR } from "@/components/gg/ui";
import { Button } from "@/components/ui/button";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { FUNCOES, ROTULO_FUNCAO } from "@/lib/gg/modelo";
import type { MembroEquipe } from "@/lib/projetos/equipe";
import { adicionarAEquipeAction, mudarFuncaoAction, tirarDaEquipeAction } from "./actions";

type Pessoa = { id: string; nome: string };
type Candidato = Pessoa & { projetos: number; tarefas: number };

export function EquipeProjeto({
  projetoId,
  podeEditar,
  atuais,
  antigos,
  responsavel,
  gp,
  candidatos,
  cargaDaEquipe,
}: {
  projetoId: string;
  podeEditar: boolean;
  atuais: MembroEquipe[];
  antigos: MembroEquipe[];
  responsavel: Pessoa;
  gp: Pessoa | null;
  candidatos: Candidato[];
  cargaDaEquipe: Record<string, { projetos: number; tarefas: number }>;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [quem, setQuem] = useState("");
  const [funcao, setFuncao] = useState<FuncaoProjeto>("MEMBRO");
  const [saindo, setSaindo] = useState<string | null>(null);

  const rodar = (chamar: () => ReturnType<typeof adicionarAEquipeAction>, acao: string, depois?: () => void) =>
    startTransition(async () => {
      const f = await executarAcao(chamar, acao);
      setErro(f);
      if (!f) {
        depois?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-fg-mute">
        Quem está na equipe vê as tarefas deste projeto e pode recebê-las. O responsável do card e o GP do handoff contam como escalados mesmo fora da lista. Sem ninguém na equipe, o time de projetos inteiro continua vendo.
      </p>
      {erro ? <MensagemErro falha={erro} className="text-sm" /> : null}

      <Painel titulo="Equipe atual" contagem={atuais.length}>
        <Tabela colunas={["Pessoa", "Função no projeto", "Desde", "Carga agora", ""]} vazio={atuais.length ? undefined : "Ninguém na equipe ainda: o time de projetos inteiro vê as tarefas."}>
          {atuais.map((m) => {
            const c = cargaDaEquipe[m.usuarioId];
            return (
              <tr key={m.id}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <Avatar nome={m.nome} usuarioId={m.usuarioId} fotoEm={m.fotoEm} className="size-6 text-[9px]" />
                    {m.nome}
                    {m.usuarioId === gp?.id ? <Chip tom="coral">GP</Chip> : null}
                    {!m.ativo ? <Chip tom="aviso">inativo</Chip> : null}
                  </span>
                </td>
                <td>
                  {podeEditar ? (
                    <select aria-label={`Função de ${m.nome}`} className={`${CAMPO} max-w-44`} value={m.funcao} disabled={pendente} onChange={(e) => rodar(() => mudarFuncaoAction(projetoId, m.id, e.target.value), "mudar a função")}>
                      {FUNCOES.map((f) => (
                        <option key={f} value={f}>
                          {ROTULO_FUNCAO[f]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Chip tom="azul">{ROTULO_FUNCAO[m.funcao]}</Chip>
                  )}
                </td>
                <td className="font-mono text-xs text-fg-soft">{diaBR(m.inicio)}</td>
                <td className="font-mono text-xs text-fg-mute">{c ? `${c.projetos} proj · ${c.tarefas} tarefas` : "—"}</td>
                <td className="text-right">
                  {podeEditar ? (
                    saindo === m.id ? (
                      <span className="inline-flex items-center gap-2" aria-live="polite">
                        <span className="text-xs text-fg-mute">Sai hoje; as tarefas ficam.</span>
                        <Button size="sm" variant="destructive" disabled={pendente} onClick={() => rodar(() => tirarDaEquipeAction(projetoId, m.id), "tirar da equipe", () => setSaindo(null))}>
                          Confirmar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSaindo(null)}>
                          Cancelar
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" aria-label={`Tirar ${m.nome} da equipe`} onClick={() => setSaindo(m.id)}>
                        Tirar da equipe
                      </Button>
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Tabela>
      </Painel>

      {podeEditar ? (
        <Painel titulo="Adicionar à equipe">
          <form
            className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (quem) rodar(() => adicionarAEquipeAction(projetoId, quem, funcao), "adicionar à equipe", () => setQuem(""));
            }}
          >
            <label className="grid gap-1.5 text-xs text-fg-mute" htmlFor="equipe-quem">
              Pessoa (com a carga atual)
              <select id="equipe-quem" className={CAMPO} value={quem} onChange={(e) => setQuem(e.target.value)} disabled={pendente}>
                <option value="">Escolha…</option>
                {candidatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} · {c.projetos} proj · {c.tarefas} tarefas
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-fg-mute" htmlFor="equipe-funcao">
              Função no projeto
              <select id="equipe-funcao" className={CAMPO} value={funcao} onChange={(e) => setFuncao(e.target.value as FuncaoProjeto)} disabled={pendente}>
                {FUNCOES.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_FUNCAO[f]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={!quem || pendente}>
              Adicionar
            </Button>
          </form>
        </Painel>
      ) : null}

      <Painel titulo="Escalados pelo card">
        <ul className="divide-y divide-border/60 text-sm">
          <li className="flex items-center gap-2 px-4 py-2.5">
            <span className="w-28 text-fg-mute">Responsável</span>
            {responsavel.nome}
          </li>
          <li className="flex items-center gap-2 px-4 py-2.5">
            <span className="w-28 text-fg-mute">GP (handoff)</span>
            {gp?.nome ?? <span className="text-fg-faint">sem GP definido</span>}
          </li>
        </ul>
      </Painel>

      {antigos.length ? (
        <Painel titulo="Passaram pela equipe" contagem={antigos.length}>
          <Tabela colunas={["Pessoa", "Função", "Período"]}>
            {antigos.map((m) => (
              <tr key={m.id} className="text-fg-mute">
                <td>{m.nome}</td>
                <td>{ROTULO_FUNCAO[m.funcao]}</td>
                <td className="font-mono text-xs">
                  {diaBR(m.inicio)} → {diaBR(m.fim)}
                </td>
              </tr>
            ))}
          </Tabela>
        </Painel>
      ) : null}
    </div>
  );
}
