import { NextResponse, type NextRequest } from "next/server";

const COOKIE_SESSAO = "ij_sessao";
const PUBLICAS = ["/login", "/convite", "/esqueci", "/redefinir", "/403", "/api/webhooks", "/api/cron", "/api/health"];

/**
 * Só checa a PRESENÇA do cookie (edge, sem banco). A validade da sessão é
 * verificada no layout de `(app)` via `exigirUsuario()`.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.get(COOKIE_SESSAO)?.value) return NextResponse.next();
  // API não redireciona: quem chama é `fetch`, que seguiria para o HTML do login.
  if (pathname === "/api" || pathname.startsWith("/api/")) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Ícones (src/app/icon.png, apple-icon.png) e a marca em public/images/ aparecem no login, sem sessão.
export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico$|icon.png$|apple-icon.png$|images/).*)"],
};
