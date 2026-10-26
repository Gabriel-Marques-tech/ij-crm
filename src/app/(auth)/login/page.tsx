import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/atual";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redefinida?: string }> }) {
  if (await usuarioAtual()) redirect("/");
  const { redefinida } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">Entre com seu email e senha.</p>
      {redefinida === "1" ? (
        <p role="status" className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-success">
          Senha redefinida. Entre com a nova senha.
        </p>
      ) : null}
      <LoginForm />
      <p className="mt-4 text-sm">
        <Link href="/esqueci" className="text-fg-mute hover:text-foreground hover:underline">
          Esqueci minha senha
        </Link>
      </p>
      <p className="mt-6 text-xs text-fg-faint">Sem conta? Peça um convite a um gestor.</p>
    </>
  );
}
