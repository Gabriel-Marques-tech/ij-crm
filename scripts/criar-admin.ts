/**
 * Cria (ou promove) o primeiro admin. Uso:
 *   ADMIN_NOME="Gabriel" ADMIN_EMAIL=g@ij.com ADMIN_SENHA='...' pnpm tsx scripts/criar-admin.ts
 * Idempotente: se o email já existe, vira ADMIN ativo e a senha é redefinida.
 */
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha, senhaAtendeRegras } from "../src/lib/auth/senha";
import { normalizarEmail } from "../src/lib/normalizacao";

const prisma = new PrismaClient();

async function main() {
  const nome = process.env.ADMIN_NOME?.trim();
  const email = normalizarEmail(process.env.ADMIN_EMAIL ?? "");
  const senha = process.env.ADMIN_SENHA ?? "";
  if (!nome || !email) throw new Error("Defina ADMIN_NOME e ADMIN_EMAIL.");
  if (!senhaAtendeRegras(senha)) throw new Error("ADMIN_SENHA precisa ter pelo menos 8 caracteres.");

  const senhaHash = await gerarHashSenha(senha);
  const u = await prisma.usuario.upsert({
    where: { email },
    update: { nome, papel: "ADMIN", ativo: true, senhaHash, conviteTokenHash: null, conviteExpiraEm: null },
    create: { nome, email, papel: "ADMIN", ativo: true, senhaHash },
    select: { id: true, email: true },
  });
  console.log(`admin pronto: ${u.email} (${u.id})`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
