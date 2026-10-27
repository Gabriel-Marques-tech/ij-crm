/**
 * Cria (ou promove) o primeiro admin. Uso:
 *   ADMIN_NOME="Gabriel" ADMIN_EMAIL=g@ij.com ADMIN_SENHA='...' pnpm tsx scripts/criar-admin.ts
 * Se o email já existe, recusa — a menos que ADMIN_FORCAR=1 (aí redefine senha,
 * promove a ADMIN e reativa). Evita resetar a conta de alguém por engano.
 */
import { db as prisma } from "../src/lib/db";
import { mensagemSegura } from "../src/lib/erros/registrar";
import { gerarHashSenha, senhaAtendeRegras } from "../src/lib/auth/senha";
import { normalizarEmail } from "../src/lib/normalizacao";

async function main() {
  const nome = process.env.ADMIN_NOME?.trim();
  const email = normalizarEmail(process.env.ADMIN_EMAIL ?? "");
  const senha = process.env.ADMIN_SENHA ?? "";
  if (!nome || !email) throw new Error("Defina ADMIN_NOME e ADMIN_EMAIL.");
  if (!senhaAtendeRegras(senha)) throw new Error("ADMIN_SENHA precisa ter pelo menos 8 caracteres.");

  const existente = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
  if (existente && process.env.ADMIN_FORCAR !== "1") {
    throw new Error(`${email} já existe. Para redefinir senha/promover, rode com ADMIN_FORCAR=1.`);
  }
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
    console.error(mensagemSegura(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
