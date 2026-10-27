/**
 * Entrada MENSAGEM_WHATSAPP da Timeline (GAB-34): o texto original do grupo
 * e, recolhido, o JSON que a LLM devolveu (com versão do prompt, modelo e o
 * que a aplicação decidiu: motivos de revisão e sugestões). Sem JS: `<details>`.
 */
type Payload = Record<string, unknown>;

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function MensagemWhatsapp({ payload }: { payload: Payload }) {
  const texto = typeof payload.texto === "string" ? payload.texto : null;
  const motivos = lista(payload.motivosRevisar);
  const temLlm = payload.saida !== undefined && payload.saida !== null;
  const modelo = typeof payload.modelo === "string" ? payload.modelo : null;
  const versao = typeof payload.versao === "string" ? payload.versao : null;
  const json = temLlm
    ? JSON.stringify({ saida: payload.saida, motivosRevisar: payload.motivosRevisar ?? [], sugestoes: payload.sugestoes ?? [] }, null, 2)
    : null;

  return (
    <div className="mt-1 space-y-1.5">
      {texto ? <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{texto}</p> : null}
      {motivos.length > 0 ? (
        <p className="text-xs text-fg-mute">
          Para revisar: <span className="text-fg-soft">{motivos.join("; ")}</span>
        </p>
      ) : null}
      {json ? (
        <details className="group rounded-lg border border-border bg-surface/60 text-xs">
          <summary className="cursor-pointer list-none px-3 py-1.5 text-fg-mute select-none hover:text-foreground">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span> Leitura da LLM
            {modelo || versao ? <span className="ml-1 font-mono text-fg-faint">({[versao, modelo].filter(Boolean).join(" · ")})</span> : null}
          </summary>
          <pre className="max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-soft">{json}</pre>
        </details>
      ) : null}
    </div>
  );
}
