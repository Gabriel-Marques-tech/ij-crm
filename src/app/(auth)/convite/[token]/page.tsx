import { buscarConvite } from "@/lib/auth/usuarios";
import { ConviteForm } from "./convite-form";

export const metadata = { title: "Convite" };

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const convite = await buscarConvite(token);

  if (!convite) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Convite inválido</h1>
        <p className="mt-2 text-sm text-fg-mute">
          Este link expirou ou já foi usado. Peça a um gestor para reenviar o convite.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow mb-2">convite</p>
      <h1 className="text-2xl font-semibold tracking-tight">Olá, {convite.nome.split(" ")[0]}.</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">
        Defina uma senha para <span className="font-mono text-fg-soft">{convite.email}</span>.
      </p>
      <ConviteForm token={token} />
    </>
  );
}
