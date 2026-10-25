import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { FormBusca } from "@/components/entidades/form-busca";
import { exigirUsuario } from "@/lib/auth/atual";
import { listarEmpresas } from "@/lib/empresas/empresas";
import { formatarCnpj } from "@/lib/normalizacao";
import { NovaEmpresa } from "./nova-empresa";

export const metadata = { title: "Empresas" };

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await exigirUsuario();
  const { q } = await searchParams;
  const busca = (Array.isArray(q) ? q[0] : q)?.slice(0, 200) ?? "";
  const empresas = await listarEmpresas(busca);

  return (
    <>
      <PageHeader eyebrow="base · empresas" title="Empresas" description="Clientes e prospects. CNPJ e domínio normalizados identificam a empresa sem ambiguidade." actions={<NovaEmpresa />} />
      <FormBusca valor={busca} rotulo="Buscar empresas" placeholder="nome, CNPJ ou domínio (ex.: acme.com.br)" />
      {empresas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong bg-surface/40 p-8 text-center text-sm text-fg-faint">
          {busca ? `Nenhuma empresa para “${busca}”.` : "Nenhuma empresa ainda. Crie aqui ou direto no card."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow px-4 py-3 font-normal">nome</th>
                <th className="eyebrow hidden px-4 py-3 font-normal md:table-cell">cnpj</th>
                <th className="eyebrow hidden px-4 py-3 font-normal sm:table-cell">domínio</th>
                <th className="eyebrow hidden px-4 py-3 font-normal lg:table-cell">local</th>
                <th className="eyebrow px-4 py-3 text-right font-normal">contatos</th>
                <th className="eyebrow px-4 py-3 text-right font-normal">cards</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/empresas/${e.id}`} className="text-foreground hover:underline">
                      {e.nome}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-xs text-fg-soft md:table-cell">{e.cnpj ? formatarCnpj(e.cnpj) : "—"}</td>
                  <td className="hidden px-4 py-2.5 font-mono text-xs text-fg-soft sm:table-cell">{e.dominioEmail ?? "—"}</td>
                  <td className="hidden px-4 py-2.5 text-fg-soft lg:table-cell">{[e.cidade, e.estado].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular text-fg-soft">{e._count.contatos}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular text-fg-soft">{e._count.oportunidades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
