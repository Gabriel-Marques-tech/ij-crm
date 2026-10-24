import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/atual";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await usuarioAtual()) redirect("/");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">Entre com seu email e senha.</p>
      <LoginForm />
      <p className="mt-6 text-xs text-fg-faint">Sem conta? Peça um convite a um gestor.</p>
    </>
  );
}
