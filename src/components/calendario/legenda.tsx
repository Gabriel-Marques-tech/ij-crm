import { cn } from "cn";
import { COR_ACAO, COR_ACAO_VENCIDA } from "./mini-card-acao";
import { FaixaChegada } from "./linha-chegada";

function Barra({ cor }: { cor: string }) {
  return <span aria-hidden className={cn("inline-block h-3 w-[3px] rounded-sm", cor)} />;
}

/** Legenda no pé da grade (mesma posição/tamanho da do ICS). */
export function Legenda({ className }: { className?: string }) {
  const itens = [
    { rotulo: "Próxima ação", marca: <Barra cor={COR_ACAO} /> },
    { rotulo: "Ação vencida", marca: <Barra cor={COR_ACAO_VENCIDA} /> },
    { rotulo: "Prazo", marca: <FaixaChegada estado="pendente" className="w-5" /> },
    { rotulo: "Prazo vencido", marca: <FaixaChegada estado="vencido" className="w-5" /> },
    { rotulo: "Prazo feito", marca: <FaixaChegada estado="feito" className="w-5" /> },
    { rotulo: "Hoje", marca: <span aria-hidden className="inline-block size-2 rounded-full bg-primary" /> },
  ];
  return (
    <div className={cn("mt-4 border-t border-border pt-4 text-xs text-fg-mute", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="font-semibold">Legenda</span>
        {itens.map(({ rotulo, marca }) => (
          <span key={rotulo} className="inline-flex items-center gap-1.5">
            {marca}
            {rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}
