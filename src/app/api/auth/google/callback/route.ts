import { callbackGoogle } from "@/lib/auth/google-rotas";

export const dynamic = "force-dynamic";

/** Retorno do Google (redirect URI = APP_URL + /api/auth/google/callback). */
export async function GET(req: Request) {
  return callbackGoogle(req);
}
