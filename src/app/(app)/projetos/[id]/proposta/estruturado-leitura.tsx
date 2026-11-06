import { formatarDinheiro } from "@/lib/projetos/formatar";
import { avisosDosDados, rotuloDaEntrega } from "@/lib/propostas/blocos-dados";
import { somaDasParcelas, type Estruturado } from "@/lib/propostas/estruturado";
import { BotaoComentarCampo } from "./comentarios-contexto";

/** Parcelas ou durações que não fecham com o valor ou o prazo: avisa, sem travar. */
export function AvisosDosDados({ dados }: { dados: Estruturado }) {
  const avisos = avisosDosDados(dados);
  if (avisos.length === 0) return null;
  return (
    <ul aria-label="Avisos dos dados" className="mt-2 space-y-1 border-l-2 border-warn pl-2 text-xs text-fg-soft">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

/** Parte estruturada só para leitura (quem não edita e as versões). */
export function EstruturadoLeitura({ e }: { e: Estruturado }) {
  const soma = somaDasParcelas(e.entregas);
  return (
    <dl className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="font-mono text-[11px] text-fg-mute uppercase">Valor<BotaoComentarCampo campo="valor" /></dt>
          <dd>{e.valor ? formatarDinheiro(e.valor) : "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] text-fg-mute uppercase">Prazo<BotaoComentarCampo campo="prazo" /></dt>
          <dd>{e.prazoDias ? `${e.prazoDias} dias` : "—"}</dd>
        </div>
      </div>
      <div>
        <dt className="font-mono text-[11px] text-fg-mute uppercase">Escopo resumido<BotaoComentarCampo campo="escopo" /></dt>
        <dd className="break-words whitespace-pre-wrap">{e.escopoResumo ?? "—"}</dd>
      </div>
      <div>
        <dt className="font-mono text-[11px] text-fg-mute uppercase">Cronograma<BotaoComentarCampo campo="entregas" /></dt>
        <dd>
          {e.entregas.length === 0 ? (
            "—"
          ) : (
            <ol className="mt-1 space-y-1">
              {e.entregas.map((x, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="w-5 font-mono text-xs text-fg-faint tabular">{i + 1}</span>
                  <span className="min-w-0 flex-1 basis-3/5 break-words">{x.titulo}</span>
                  <span className="font-mono text-xs text-fg-mute tabular">{rotuloDaEntrega(x)}</span>
                  <span className="ml-auto text-right font-mono text-xs tabular">{x.valor ? formatarDinheiro(x.valor) : "—"}</span>
                </li>
              ))}
            </ol>
          )}
          {soma ? <p className="mt-1 text-right font-mono text-[11px] text-fg-faint">soma das parcelas: {formatarDinheiro(soma)}</p> : null}
        </dd>
      </div>
      <AvisosDosDados dados={e} />
    </dl>
  );
}
