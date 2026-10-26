/**
 * Falha inesperada ao carregar os dados de uma página (server component): a
 * leitura vai em `comTratamento`, que loga a causa com a ref; aqui o usuário vê
 * a mesma ref para repassar (`grep 'ref=<ref>'` nos logs).
 */
export function ErroCarregamento({ codigo }: { codigo: string }) {
  return (
    <div role="alert" className="rounded-xl border border-l-2 border-border border-l-danger bg-surface p-5">
      <p className="font-medium">Não deu para carregar esta página.</p>
      <p className="mt-1 text-sm text-fg-mute">
        Erro no servidor (ref: <span className="font-mono text-fg-soft">{codigo}</span>). Recarregue; se persistir, informe a ref.
      </p>
    </div>
  );
}
