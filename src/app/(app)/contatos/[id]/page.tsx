import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampoEditavel } from "@/components/entidades/campo-editavel";
import { ListaOportunidades } from "@/components/entidades/lista-oportunidades";
import { exigirUsuario } from "@/lib/auth/atual";
import { SecaoGestao } from "@/components/merge/secao-gestao";
import { destinoDeMesclado } from "@/lib/merge/merge";
import { obterContato } from "@/lib/contatos/contatos";
import { textoVinculo } from "@/lib/entidades/vinculo";
import { editarContatoCampoAction } from "../actions";
import { EmpresaDoContato } from "./empresa-do-contato";
import { Pontos } from "./pontos";

export const metadata = { title: "Contato" };

export default async function ContatoPage({ params }: { params: Promise<{ id: string }> }) {
  const eu = await exigirUsuario();
  const { id } = await params;
  const c = await obterContato(id);
  if (!c) {
    // Mesclado: o link velho leva ao principal, que mostra tudo (GAB-36).
    const destino = await destinoDeMesclado("contato", id);
    if (destino) redirect(`/contatos/${destino}`);
    notFound();
  }
  const salvar = (campo: string) => editarContatoCampoAction.bind(null, c.id, campo);
  // Empresa excluída/mesclada aparece como tal (nunca como ativa).
  const empresa = c.empresa;

  return (
    <>
      <Link href="/contatos" className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Contatos
      </Link>

      <header className="mb-6 rounded-xl border border-border bg-surface p-4">
        <p className="eyebrow mb-1">contato{empresa?.estado === "ATIVO" ? ` · ${empresa.nome}` : ""}</p>
        <CampoEditavel id="contato-nome" rotulo="Nome" valor={c.nome} salvar={salvar("nome")} className="[&_button]:text-xl [&_button]:font-semibold [&>p]:text-xl [&>p]:font-semibold [&>label]:sr-only" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium">Dados</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <EmpresaDoContato contatoId={c.id} empresa={empresa} />
              <CampoEditavel id="contato-cargo" rotulo="Cargo" valor={c.cargo ?? ""} salvar={salvar("cargo")} />
              <CampoEditavel id="contato-obs" rotulo="Observações" tipo="textarea" valor={c.observacoes ?? ""} salvar={salvar("observacoes")} className="sm:col-span-2" />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">Telefones e emails</h2>
            <Pontos contatoId={c.id} pontos={c.pontos} />
          </section>

          <SecaoGestao tipo="contato" atual={{ id: c.id, nome: c.nome }} papel={eu.papel} />
        </div>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium">
            Oportunidades <span className="font-mono text-xs text-fg-mute tabular">{c.oportunidades.length}</span>
          </h2>
          <ListaOportunidades itens={c.oportunidades.map((o) => ({ ...o, extra: textoVinculo("empresa", o.empresa) }))} />
        </section>
      </div>
    </>
  );
}
