import { NextResponse, type NextRequest } from "next/server";

const COOKIE_SESSAO = "ij_sessao";
const PUBLICAS = ["/login", "/convite", "/403", "/api/webhooks", "/api/cron"];

/**
 * Só checa a PRESENÇA do cookie (edge, sem banco). A validade da sessão é
 * verificada no layout de `(app)` via `exigirUsuario()`.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get(COOKIE_SESSAO)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico$|images/).*)"],
};
