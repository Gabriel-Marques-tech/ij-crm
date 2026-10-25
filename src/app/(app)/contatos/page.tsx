import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { FormBusca } from "@/components/entidades/form-busca";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarContatos } from "@/lib/contatos/contatos";
import { NovoContato } from "./novo-contato";

export const metadata = { title: "Contatos" };

export default async function ContatosPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await exigirUsuario();
  const { q } = await searchParams;
  const busca = (Array.isArray(q) ? q[0] : q)?.slice(0, 200) ?? "";
  const contatos = await listarContatos(busca);

  return (
    <>
      <PageHeader eyebrow="base · contatos" title="Contatos" description="Pessoas, com telefones e emails normalizados — cada um pertence a um só contato." actions={<NovoContato />} />
      <FormBusca valor={busca} rotulo="Buscar contatos" placeholder="nome, telefone ou email" />
      {contatos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong bg-surface/40 p-8 text-center text-sm text-fg-faint">
          {busca ? `Nenhum contato para “${busca}”.` : "Nenhum contato ainda. Crie aqui ou direto no card."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow px-4 py-3 font-normal">nome</th>
                <th className="eyebrow hidden px-4 py-3 font-normal sm:table-cell">empresa</th>
                <th className="eyebrow hidden px-4 py-3 font-normal md:table-cell">telefones e emails</th>
                <th className="eyebrow px-4 py-3 text-right font-normal">cards</th>
              </tr>
            </thead>
            <tbody>
              {contatos.map((c) => (
                <tr key={c.id} className="border-b border-border align-top last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/contatos/${c.id}`} className="text-foreground hover:underline">
                      {c.nome}
                    </Link>
                    {c.cargo ? <span className="block text-xs text-fg-mute">{c.cargo}</span> : null}
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    {c.empresa ? (
                      <Link href={`/empresas/${c.empresa.id}`} className="text-fg-soft hover:text-foreground hover:underline">
                        {c.empresa.nome}
                      </Link>
                    ) : (
                      <span className="text-fg-faint">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-fg-soft">
                      {c.pontos.length === 0 ? <span className="text-fg-faint">—</span> : null}
                      {c.pontos.map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-1">
                          {p.tipo === "TELEFONE" ? <Phone className="size-3" aria-hidden /> : <Mail className="size-3" aria-hidden />}
                          {p.valorNormalizado}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular text-fg-soft">{c._count.oportunidades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
