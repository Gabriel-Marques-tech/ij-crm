import { buscarRedefinicao } from "@/lib/auth/redefinicao";
import { RedefinirForm } from "./redefinir-form";

export const metadata = { title: "Nova senha", referrer: "no-referrer" as const };

export default async function RedefinirPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const u = await buscarRedefinicao(token);

  if (!u) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Link inválido</h1>
        <p className="mt-2 text-sm text-fg-mute">
          Este link expirou ou já foi usado (vale 1 hora, uma vez). Peça um novo a um gestor.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow mb-2">nova senha</p>
      <h1 className="text-2xl font-semibold tracking-tight">Olá, {u.nome.split(" ")[0]}.</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">
        Defina uma nova senha para <span className="font-mono text-fg-soft">{u.email}</span>. Todas as sessões abertas serão
        encerradas.
      </p>
      <RedefinirForm token={token} />
    </>
  );
}
