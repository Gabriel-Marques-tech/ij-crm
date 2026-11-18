import Link from "next/link";
import { googleConfigurado } from "@/lib/auth/google";
import { buscarConvite } from "@/lib/auth/usuarios";
import { BotaoGoogle } from "../../login/botao-google";
import { ConviteForm } from "./convite-form";

export const metadata = { title: "Convite" };

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const convite = await buscarConvite(token);
  const google = googleConfigurado();

  if (!convite) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Convite inválido</h1>
        <p className="mt-2 text-sm text-fg-mute">
          {google
            ? "Este link expirou ou já foi usado. Se seu email está cadastrado, entre com Google na tela de login; senão, peça a um gestor."
            : "Este link expirou ou já foi usado. Peça a um gestor para reenviar o convite."}
        </p>
        {google ? (
          <p className="mt-4 text-sm">
            <Link href="/login" className="text-fg-mute hover:text-foreground hover:underline">
              Ir para o login
            </Link>
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <p className="eyebrow mb-2">convite</p>
      <h1 className="text-2xl font-semibold tracking-tight">Olá, {convite.nome.split(" ")[0]}.</h1>
      {google ? (
        <>
          <p className="mt-1 mb-6 text-sm text-fg-mute">
            Entre com a conta Google de <span className="font-mono text-fg-soft">{convite.email}</span>, sem criar senha.
          </p>
          <BotaoGoogle />
          <div className="my-6 flex items-center gap-3 text-xs text-fg-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            ou defina uma senha
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : (
        <p className="mt-1 mb-6 text-sm text-fg-mute">
          Defina uma senha para <span className="font-mono text-fg-soft">{convite.email}</span>.
        </p>
      )}
      <ConviteForm token={token} autoFocus={!google} />
    </>
  );
}
