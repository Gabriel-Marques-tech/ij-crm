import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario, idSessaoAtual } from "@/lib/auth/atual";
import { descreverLado } from "@/lib/auth/areas";
import { descreverDispositivo } from "@/lib/auth/dispositivo";
import { ROTULO_PAPEL } from "@/lib/auth/papeis";
import { listarSessoes } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { paginaInicial } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";
import { EmailForm, PaginaInicialForm, SenhaForm } from "./conta-forms";
import { FotoPerfil } from "./foto-perfil";
import { PerfilForm } from "./perfil-form";
import { Sessoes } from "./sessoes";

export const metadata = { title: "Meu perfil" };

export default async function PerfilPage() {
  const eu = await exigirUsuario();
  const dados = await comTratamento("pagina.perfil", () =>
    Promise.all([
      db.usuario.findUniqueOrThrow({
        where: { id: eu.id },
        select: { nome: true, email: true, papel: true, area: true, cargos: true, telefoneWhatsapp: true, foto: { select: { atualizadoEm: true } } },
      }),
      obterPreferencias(eu.id),
      idSessaoAtual().then((atual) => listarSessoes(eu.id, atual)),
    ]),
  );
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const [u, prefs, sessoes] = dados;
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
            <dd className="text-fg-soft">{ROTULO_PAPEL[u.papel]}</dd>
            <dt className="eyebrow">área</dt>
            <dd className="text-fg-soft">{descreverLado(u)}</dd>
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
