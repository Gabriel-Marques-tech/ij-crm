import Link from "next/link";
import { EsqueciForm } from "./esqueci-form";

export const metadata = { title: "Esqueci minha senha" };

export default function EsqueciPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Esqueci minha senha</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">
        Informe seu email. Um gestor recebe o pedido no CRM e te manda um link para criar uma nova senha.
      </p>
      <EsqueciForm />
      <p className="mt-6 text-xs text-fg-faint">
        <Link href="/login" className="hover:text-foreground hover:underline">
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
