import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { listarUsuarios } from "@/lib/auth/usuarios";
import { ConvidarDialog } from "./convidar-dialog";
import { TabelaUsuarios } from "./tabela-usuarios";

export const metadata = { title: "Usuários" };

export default async function UsuariosPage() {
  const ator = await exigirPapel("GESTOR");
  const usuarios = await listarUsuarios();
  return (
    <>
      <PageHeader
        eyebrow="gestão · usuários"
        title="Usuários"
        description="Quem acessa o CRM e qual telefone liga a pessoa às mensagens do grupo."
        actions={<ConvidarDialog papelAtor={ator.papel} />}
      />
      <TabelaUsuarios usuarios={usuarios} ator={ator} />
    </>
  );
}
