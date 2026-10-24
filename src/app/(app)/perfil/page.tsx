import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { db } from "@/lib/db";
import { PerfilForm } from "./perfil-form";

export const metadata = { title: "Meu perfil" };

const ROTULO = { ADMIN: "Admin", GESTOR: "Gestor", VENDEDOR: "Vendedor" } as const;

export default async function PerfilPage() {
  const eu = await exigirUsuario();
  const u = await db.usuario.findUniqueOrThrow({
    where: { id: eu.id },
    select: { nome: true, email: true, papel: true, telefoneWhatsapp: true },
  });
  return (
    <>
      <PageHeader
        eyebrow="meu perfil"
        title={u.nome}
        description="Seu telefone é o que liga suas mensagens no grupo do WhatsApp aos cards do CRM."
      />
      <div className="max-w-md space-y-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="eyebrow">email</dt>
          <dd className="font-mono text-fg-soft">{u.email}</dd>
          <dt className="eyebrow">papel</dt>
          <dd className="text-fg-soft">{ROTULO[u.papel]}</dd>
        </dl>
        <PerfilForm nome={u.nome} telefone={u.telefoneWhatsapp ?? ""} />
      </div>
    </>
  );
}
