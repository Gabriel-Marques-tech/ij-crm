import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { podeGerarRedefinicao } from "@/lib/auth/papeis";
import { listarUsuarios } from "@/lib/auth/usuarios";
import { ConvidarDialog } from "./convidar-dialog";
import { TabelaUsuarios } from "./tabela-usuarios";

export const metadata = { title: "Usuários" };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function UsuariosPage() {
  const ator = await exigirPapel("GESTOR");
  const usuarios = await listarUsuarios();
  // "Esqueci a senha" (GAB-43): pedidos abertos de contas ativas.
  const pedidos = usuarios.filter((u) => u.ativo && u.redefinicaoPedidaEm);
  return (
    <>
      <PageHeader
        eyebrow="gestão · usuários"
        title="Usuários"
        description="Quem acessa o CRM e qual telefone liga a pessoa às mensagens do grupo."
        actions={<ConvidarDialog papelAtor={ator.papel} />}
      />
      {pedidos.length > 0 ? (
        <section className="mb-6 rounded-xl border border-l-2 border-border border-l-danger bg-surface p-4">
          <p className="eyebrow mb-2">
            pedidos de nova senha · <span className="font-mono">{pedidos.length}</span>
          </p>
          <ul className="space-y-1 text-sm">
            {pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{p.nome}</span>
                <span className="font-mono text-xs text-fg-mute">{p.email}</span>
                <span className="font-mono text-xs text-fg-faint">{fmt.format(p.redefinicaoPedidaEm!)}</span>
                {!podeGerarRedefinicao(ator.papel, p.papel) ? <span className="text-xs text-fg-faint">· só um admin pode gerar o link</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-faint">
            Confirme com a pessoa por outro canal e use o botão de chave na linha dela para gerar o link (vale 1 h, uso único).
          </p>
        </section>
      ) : null}
      <TabelaUsuarios usuarios={usuarios} ator={ator} />
    </>
  );
}
