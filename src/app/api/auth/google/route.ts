import { iniciarLoginGoogle } from "@/lib/auth/google-rotas";

export const dynamic = "force-dynamic";

/** Entrar com Google: redireciona ao Google (404 sem GOOGLE_CLIENT_ID/SECRET). */
export async function GET(req: Request) {
  return iniciarLoginGoogle(req);
}
