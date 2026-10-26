import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario, idSessaoAtual } from "@/lib/auth/atual";
import { descreverDispositivo } from "@/lib/auth/dispositivo";
import { listarSessoes } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { paginaInicial } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";
import { EmailForm, PaginaInicialForm, SenhaForm } from "./conta-forms";
import { FotoPerfil } from "./foto-perfil";
import { PerfilForm } from "./perfil-form";
import { Sessoes } from "./sessoes";

export const metadata = { title: "Meu perfil" };

const ROTULO = { ADMIN: "Admin", GESTOR: "Gestor", VENDEDOR: "Vendedor" } as const;

export default async function PerfilPage() {
  const eu = await exigirUsuario();
  const [u, prefs, sessoes] = await Promise.all([
    db.usuario.findUniqueOrThrow({
      where: { id: eu.id },
      select: { nome: true, email: true, papel: true, telefoneWhatsapp: true, foto: { select: { atualizadoEm: true } } },
    }),
    obterPreferencias(eu.id),
    idSessaoAtual().then((atual) => listarSessoes(eu.id, atual)),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="meu perfil"
        title={u.nome}
        description="Seu telefone é o que liga suas mensagens no grupo do WhatsApp aos cards do CRM."
      />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <FotoPerfil usuarioId={eu.id} nome={u.nome} fotoEm={u.foto?.atualizadoEm.getTime() ?? null} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="eyebrow">email</dt>
            <dd className="font-mono text-fg-soft">{u.email}</dd>
            <dt className="eyebrow">papel</dt>
            <dd className="text-fg-soft">{ROTULO[u.papel]}</dd>
          </dl>
          <PerfilForm nome={u.nome} telefone={u.telefoneWhatsapp ?? ""} />
          <PaginaInicialForm atual={paginaInicial(prefs)} />
        </div>
        <div className="space-y-6">
          <SenhaForm />
          <EmailForm email={u.email} />
          <Sessoes
            sessoes={sessoes.map((s) => ({
              id: s.id,
              dispositivo: descreverDispositivo(s.userAgent),
              criadoEm: s.criadoEm.toISOString(),
              ultimoUsoEm: s.ultimoUsoEm.toISOString(),
              atual: s.atual,
            }))}
          />
        </div>
      </div>
    </>
  );
}
