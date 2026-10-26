import type { RespostaBusca } from "@/components/entidades/busca-entidade";
import { buscarContatosAction } from "./actions";

/** Adapta a busca de contatos ao autocomplete (empresa como detalhe). Roda no cliente. */
export async function buscarContatosParaAutocomplete(q: string): Promise<RespostaBusca> {
  const r = await buscarContatosAction(q);
  return r.ok ? { ok: true, opcoes: r.opcoes.map((c) => ({ id: c.id, nome: c.nome, detalhe: c.empresa })) } : r;
}
