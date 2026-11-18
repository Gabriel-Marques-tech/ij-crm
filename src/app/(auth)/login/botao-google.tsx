import { buttonVariants } from "@/components/ui/button";

/** Link (não form): o início do fluxo é um GET que redireciona ao Google. */
export function BotaoGoogle({ voltar, rotulo = "Entrar com Google" }: { voltar?: string | null; rotulo?: string }) {
  const href = voltar ? `/api/auth/google?voltar=${encodeURIComponent(voltar)}` : "/api/auth/google";
  return (
    <a href={href} className={buttonVariants({ variant: "outline", className: "w-full" })}>
      <IconeGoogle />
      {rotulo}
    </a>
  );
}

function IconeGoogle() {
  // "G" monocromático (currentColor): o tema não usa cor solta em componente.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21.35 11.1H12v2.9h5.35c-.23 1.5-1.68 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.95S8.78 6.5 12 6.5c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.94 14.55 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.14-1.5z" />
    </svg>
  );
}
