import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { CampoEditavel } from "@/components/entidades/campo-editavel";
import { ListaOportunidades } from "@/components/entidades/lista-oportunidades";
import { exigirUsuario } from "@/lib/auth/atual";
import { obterEmpresa } from "@/lib/empresas/empresas";
import { formatarCnpj } from "@/lib/normalizacao";
import { UFS } from "@/lib/oportunidades/campos";
import { editarEmpresaCampoAction } from "../actions";

export const metadata = { title: "Empresa" };

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario();
  const { id } = await params;
  const e = await obterEmpresa(id);
  if (!e) notFound();
  const salvar = (campo: string) => editarEmpresaCampoAction.bind(null, e.id, campo);

  return (
    <>
      <Link href="/empresas" className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Empresas
      </Link>

      <header className="mb-6 rounded-xl border border-border bg-surface p-4">
        <p className="eyebrow mb-1">empresa{e.cnpj ? ` · ${formatarCnpj(e.cnpj)}` : ""}</p>
        <CampoEditavel id="empresa-nome" rotulo="Nome" valor={e.nome} salvar={salvar("nome")} className="[&_button]:text-xl [&_button]:font-semibold [&>label]:sr-only" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-4 text-sm font-medium">Dados</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoEditavel id="empresa-cnpj" rotulo="CNPJ" valor={e.cnpj ?? ""} exibicao={e.cnpj ? formatarCnpj(e.cnpj) : undefined} mono salvar={salvar("cnpj")} />
            <CampoEditavel id="empresa-dominio" rotulo="Domínio de email" valor={e.dominioEmail ?? ""} mono salvar={salvar("dominioEmail")} />
            <CampoEditavel id="empresa-cidade" rotulo="Cidade" valor={e.cidade ?? ""} salvar={salvar("cidade")} />
            <CampoEditavel
              id="empresa-estado"
              rotulo="Estado"
              tipo="select"
              valor={e.estado ?? ""}
              opcoes={[{ valor: "", rotulo: "—" }, ...UFS.map((uf) => ({ valor: uf, rotulo: uf }))]}
              salvar={salvar("estado")}
            />
            <CampoEditavel id="empresa-site" rotulo="Site" valor={e.site ?? ""} salvar={salvar("site")} className="sm:col-span-2" />
            <CampoEditavel id="empresa-obs" rotulo="Observações" tipo="textarea" valor={e.observacoes ?? ""} salvar={salvar("observacoes")} className="sm:col-span-2" />
          </div>
          {e.site ? (
            <a href={e.site} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-mono text-[11px] text-fg-mute hover:text-foreground hover:underline">
              abrir site ↗
            </a>
          ) : null}
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">
              Contatos <span className="font-mono text-xs text-fg-mute tabular">{e.contatos.length}</span>
            </h2>
            {e.contatos.length === 0 ? (
              <p className="text-sm text-fg-faint">Nenhum contato. Defina a empresa no detalhe do contato.</p>
            ) : (
              <ul className="divide-y divide-border">
                {e.contatos.map((c) => (
                  <li key={c.id} className="py-2">
                    <Link href={`/contatos/${c.id}`} className="text-sm text-foreground hover:underline">
                      {c.nome}
                    </Link>
                    {c.cargo ? <span className="ml-2 text-xs text-fg-mute">{c.cargo}</span> : null}
                    {c.pontos.length > 0 ? (
                      <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-fg-mute">
                        {c.pontos.map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1">
                            {p.tipo === "TELEFONE" ? <Phone className="size-3" aria-hidden /> : <Mail className="size-3" aria-hidden />}
                            {p.valorNormalizado}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">
              Oportunidades <span className="font-mono text-xs text-fg-mute tabular">{e.oportunidades.length}</span>
            </h2>
            <ListaOportunidades itens={e.oportunidades.map((o) => ({ ...o, extra: o.contato?.nome }))} />
          </section>
        </div>
      </div>
    </>
  );
}
