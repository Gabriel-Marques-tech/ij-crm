/**
 * Smoke de autorização contra um servidor rodando (BASE_URL, default :3100).
 * Cria sessões direto no banco e checa redirects/guards por papel.
 * Uso: pnpm tsx scripts/smoke-auth.ts
 */
import { PrismaClient } from "@prisma/client";
import { criarSessao } from "../src/lib/auth/sessao";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

async function get(path: string, cookie?: string) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie: `ij_sessao=${cookie}` } : {} });
  return { status: r.status, location: r.headers.get("location") };
}

function esperar(nome: string, cond: boolean, detalhe: unknown) {
  console.log(`${cond ? "ok " : "FAIL"} ${nome} ${cond ? "" : JSON.stringify(detalhe)}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const admin = await prisma.usuario.findFirst({ where: { papel: "ADMIN", ativo: true } });
  if (!admin) throw new Error("rode pnpm admin:criar antes");
  const vendedor = await prisma.usuario.upsert({
    where: { email: "smoke-vendedor@ij.test" },
    update: { ativo: true, papel: "VENDEDOR" },
    create: { nome: "Smoke Vendedor", email: "smoke-vendedor@ij.test", papel: "VENDEDOR" },
  });
  const sAdmin = await criarSessao(admin.id);
  const sVend = await criarSessao(vendedor.id);

  let r = await get("/");
  esperar("sem cookie → /login", r.status === 307 && r.location?.endsWith("/login") === true, r);
  r = await get("/", "0".repeat(64));
  esperar("cookie inválido → /login", r.status === 307 && r.location?.endsWith("/login") === true, r);
  r = await get("/login");
  esperar("/login público 200", r.status === 200, r);
  r = await get("/convite/" + "a".repeat(64));
  esperar("/convite inválido 200 (mensagem)", r.status === 200, r);
  r = await get("/", sAdmin);
  esperar("admin / 200", r.status === 200, r);
  r = await get("/gestao/usuarios", sAdmin);
  esperar("admin /gestao/usuarios 200", r.status === 200, r);
  r = await get("/", sVend);
  esperar("vendedor / 200", r.status === 200, r);
  r = await get("/gestao", sVend);
  esperar("vendedor /gestao → /403", r.status === 307 && r.location?.endsWith("/403") === true, r);
  r = await get("/gestao/usuarios", sVend);
  esperar("vendedor /gestao/usuarios → /403", r.status === 307 && r.location?.endsWith("/403") === true, r);
  r = await get("/login", sAdmin);
  esperar("logado em /login → /", r.status === 307 && r.location?.endsWith("/") === true, r);

  await prisma.sessao.deleteMany({ where: { id: { in: [sAdmin, sVend] } } });
  await prisma.usuario.delete({ where: { id: vendedor.id } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
