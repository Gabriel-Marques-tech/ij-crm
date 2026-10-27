import type { ReactNode } from "react";

/**
 * Falha inesperada ao carregar os dados de uma página (server component): a
 * leitura vai em `comTratamento`, que loga a causa com a ref; aqui o usuário vê
 * a mesma ref para repassar (`grep 'ref=<ref>'` nos logs). Sem `codigo` (erro
 * no próprio navegador, nada no log do servidor) a mensagem vai sem ref.
 */
export function ErroCarregamento({ codigo, acao }: { codigo?: string; acao?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-l-2 border-border border-l-danger bg-surface p-5">
      <p className="font-medium">Não deu para carregar esta página.</p>
      <p className="mt-1 text-sm text-fg-mute">
        {codigo ? (
          <>
            Erro no servidor (ref: <span className="font-mono text-fg-soft">{codigo}</span>). {acao ? "Tente de novo" : "Recarregue"}; se persistir, informe a ref.
          </>
        ) : (
          <>Erro inesperado. Tente de novo; se persistir, avise quem cuida do CRM.</>
        )}
      </p>
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}
