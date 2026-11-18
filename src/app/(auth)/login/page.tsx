import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/atual";
import { destinoSeguro } from "@/lib/auth/destino";
import { googleConfigurado, lerDominios, mensagemErroGoogle } from "@/lib/auth/google";
import { BotaoGoogle } from "./botao-google";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

type Params = { redefinida?: string; voltar?: string; erro?: string; ref?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { redefinida, voltar: bruto, erro, ref } = await searchParams;
  const voltar = destinoSeguro(bruto);
  if (await usuarioAtual()) redirect(voltar ?? "/");
  const google = googleConfigurado();
  const erroGoogle = mensagemErroGoogle(erro, lerDominios(process.env.GOOGLE_DOMINIOS_PERMITIDOS));
  const refSegura = ref && /^[0-9a-f]{8}$/.test(ref) ? ref : null;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">{google ? "Entre com sua conta Google ou com email e senha." : "Entre com seu email e senha."}</p>
      {redefinida === "1" ? (
        <p role="status" className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-success">
          Senha redefinida. Entre com a nova senha.
        </p>
      ) : null}
      {erroGoogle ? (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-danger">
          {erroGoogle}
          {refSegura ? <span className="mt-1 block font-mono text-xs text-fg-faint">ref: {refSegura}</span> : null}
        </p>
      ) : null}
      {google ? (
        <>
          <BotaoGoogle voltar={voltar} />
          <div className="my-6 flex items-center gap-3 text-xs text-fg-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            ou com email e senha
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <LoginForm voltar={voltar} autoFocus={!google} />
      <p className="mt-4 text-sm">
        <Link href="/esqueci" className="text-fg-mute hover:text-foreground hover:underline">
          Esqueci minha senha
        </Link>
      </p>
      <p className="mt-6 text-xs text-fg-faint">Sem acesso? Peça a um gestor para cadastrar seu email.</p>
    </>
  );
}
