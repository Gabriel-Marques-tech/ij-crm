import { Trash2 } from "lucide-react";
import type { Papel } from "@prisma/client";
import { AcaoConfirmada } from "@/components/lixeira/acao-confirmada";
import { desfazerMergeAction, excluirEntidadeAction } from "@/app/(app)/_lixeira/actions";
import { podeExcluirEntidade, podeMesclar } from "@/lib/lixeira/regras";
import { listarMesclados } from "@/lib/merge/merge";
import { Mesclar } from "./mesclar";

/**
 * Detalhe de Contato/Empresa, parte de gestão (gestor+; vendedor não vê):
 * mesclados aqui (com desfazer), mesclar um duplicado, excluir (lixeira).
 */
export async function SecaoGestao({ tipo, atual, papel }: { tipo: "contato" | "empresa"; atual: { id: string; nome: string }; papel: Papel }) {
  if (!podeMesclar(papel) && !podeExcluirEntidade(papel)) return null;
  const mesclados = await listarMesclados(tipo, atual.id);
  const artigo = tipo === "contato" ? "o contato" : "a empresa";
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Duplicados</h2>
      {mesclados.length > 0 ? (
        <div className="mb-4">
          <p className="mb-1 text-xs text-fg-mute">Mesclados aqui (o que era deles aparece nesta página):</p>
          <ul className="divide-y divide-border">
            {mesclados.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="truncate text-fg-soft">{m.nome}</span>
                <AcaoConfirmada
                  rotulo="Desfazer merge"
                  tamanho="xs"
                  titulo="Desfazer o merge?"
                  descricao={`“${m.nome}” volta a ser um registro separado, com o que sempre foi dele.`}
                  confirmar="Desfazer"
                  rotuloAcao="desfazer o merge"
                  acao={desfazerMergeAction.bind(null, tipo, m.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Mesclar tipo={tipo} atual={atual} />
      <div className="mt-4 border-t border-border pt-3">
        <AcaoConfirmada
          rotulo={
            <>
              <Trash2 aria-hidden /> Excluir {tipo === "contato" ? "contato" : "empresa"}
            </>
          }
          variante="ghost"
          tamanho="xs"
          titulo={`Excluir ${artigo}?`}
          descricao={`“${atual.nome}” vai para a lixeira (Gestão → Lixeira) e pode ser restaurad${tipo === "contato" ? "o" : "a"}. Enquanto estiver lá, telefones/emails/CNPJ continuam reservados.`}
          confirmar="Excluir"
          rotuloAcao={`excluir ${artigo}`}
          acao={excluirEntidadeAction.bind(null, tipo, atual.id)}
        />
      </div>
    </section>
  );
}
