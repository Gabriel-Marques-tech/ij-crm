import { Trash2 } from "lucide-react";
import { excluirCardAction } from "@/app/(app)/_lixeira/actions";
import { AcaoConfirmada } from "./acao-confirmada";

/** Excluir card (qualquer usuário): vai para a lixeira; gestor/admin restauram. */
export function ExcluirCard({ cardId, titulo, quadro }: { cardId: string; titulo: string; quadro: string }) {
  return (
    <span className="ml-auto">
      <AcaoConfirmada
        rotulo={
          <>
            <Trash2 aria-hidden /> Excluir
          </>
        }
        variante="ghost"
        tamanho="xs"
        titulo="Excluir o card?"
        descricao={`“${titulo}” vai para a lixeira e some do Kanban, da Tabela e da Minha Semana. Gestor ou admin podem restaurar.`}
        confirmar="Excluir"
        rotuloAcao="excluir o card"
        acao={excluirCardAction.bind(null, cardId, quadro)}
      />
    </span>
  );
}
