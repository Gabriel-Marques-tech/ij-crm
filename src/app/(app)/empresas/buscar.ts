import type { RespostaBusca } from "@/components/entidades/busca-entidade";
import { formatarCnpj } from "@/lib/normalizacao";
import { buscarEmpresasAction } from "./actions";

/** Adapta a busca de empresas ao autocomplete (CNPJ como detalhe). Roda no cliente. */
export async function buscarEmpresasParaAutocomplete(q: string): Promise<RespostaBusca> {
  const r = await buscarEmpresasAction(q);
  return r.ok ? { ok: true, opcoes: r.opcoes.map((e) => ({ id: e.id, nome: e.nome, detalhe: e.cnpj ? formatarCnpj(e.cnpj) : null })) } : r;
}
