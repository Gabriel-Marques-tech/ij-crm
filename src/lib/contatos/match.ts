/**
 * Match por identificador EXATO (design doc §2 anti-objetivo, §4.3 passo 6).
 * É o que a ingestão do WhatsApp e o import usam para reaproveitar
 * Contato/Empresa — por isso nunca casa por nome, nem aproximado: só valor
 * normalizado igual ao gravado.
 *
 * - `encontrarContatoPorIdentificador("11 9999-8888" | "Ana@Acme.com")`
 * - `encontrarEmpresa("12.ABC.345/01DE-35" | "ana@acme.com.br" | "https://acme.com.br")`
 *
 * Mesclados (`merged_into_id`) resolvem para o destino (cadeia resolvida em
 * lote, uma query por salto). Aceita um cliente de transação para rodar
 * dentro da ingestão.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ehDominioPublico, normalizarCnpj, normalizarDominio, normalizarPonto } from "@/lib/normalizacao";

type Cliente = Prisma.TransactionClient;

export type ContatoEncontrado = { id: string; nome: string; empresaId: string | null };
export type EmpresaEncontrada = { id: string; nome: string };

/** Fim da cadeia de merge de um registro: o vivo (ou o excluído onde ela termina). */
export type Resolvido = { id: string; nome: string; deletado: boolean; mesclado: boolean };

/** Teto de saltos de merge (merge é manual e raro; evita laço se houver ciclo por erro). */
const MAX_SALTOS = 5;

type Linha = { id: string; nome: string; mergedIntoId: string | null; deletadoEm: Date | null };

async function resolverCadeias(buscar: (ids: string[]) => Promise<Linha[]>, ids: string[]): Promise<Map<string, Resolvido>> {
  const atual = new Map(ids.map((id) => [id, id])); // origem → posição atual na cadeia
  const fim = new Map<string, Resolvido>();
  const mesclado = new Set<string>();
  for (let salto = 0; salto <= MAX_SALTOS && atual.size > 0; salto++) {
    const linhas = new Map((await buscar([...new Set(atual.values())])).map((l) => [l.id, l]));
    for (const [origem, pos] of [...atual]) {
      const l = linhas.get(pos);
      if (!l) {
        atual.delete(origem); // some do mapa: id inexistente
      } else if (l.mergedIntoId && !l.deletadoEm) {
        atual.set(origem, l.mergedIntoId);
        mesclado.add(origem);
      } else {
        fim.set(origem, { id: l.id, nome: l.nome, deletado: l.deletadoEm !== null, mesclado: mesclado.has(origem) });
        atual.delete(origem);
      }
    }
  }
  return fim;
}

const SELECAO = { id: true, nome: true, mergedIntoId: true, deletadoEm: true } as const;

/** Resolve a cadeia de merge de contatos, em lote. Ausente no mapa = id inexistente ou ciclo. */
export function resolverContatos(ids: string[], cliente: Cliente = db) {
  return resolverCadeias((lote) => cliente.contato.findMany({ where: { id: { in: lote } }, select: SELECAO }), ids);
}

/** Resolve a cadeia de merge de empresas, em lote. */
export function resolverEmpresas(ids: string[], cliente: Cliente = db) {
  return resolverCadeias((lote) => cliente.empresa.findMany({ where: { id: { in: lote } }, select: SELECAO }), ids);
}

export type MatchContato =
  | { tipo: "ENCONTRADO"; contato: ContatoEncontrado }
  | { tipo: "NAO_ENCONTRADO" }
  /**
   * O ponto existe, mas o dono (fim da cadeia de merge) está soft-deletado.
   * O valor continua BLOQUEADO (o unique é global): quem chama (ingestão
   * GAB-34/37, import) manda para revisão humana — nunca cria contato novo
   * nem tenta gravar o ponto de novo.
   */
  | { tipo: "BLOQUEADO_EXCLUIDO"; contatoId: string };

/** Telefone ou email (decide pela forma: com `@` é email). Não normaliza → NAO_ENCONTRADO. */
export async function encontrarContatoPorIdentificador(entrada: string, cliente: Cliente = db): Promise<MatchContato> {
  const p = normalizarPonto(entrada);
  if (!p) return { tipo: "NAO_ENCONTRADO" };
  const ponto = await cliente.contatoPonto.findUnique({
    where: { tipo_valorNormalizado: { tipo: p.tipo, valorNormalizado: p.valorNormalizado } },
    select: { contatoId: true },
  });
  if (!ponto) return { tipo: "NAO_ENCONTRADO" };
  const r = (await resolverContatos([ponto.contatoId], cliente)).get(ponto.contatoId);
  if (!r || r.deletado) return { tipo: "BLOQUEADO_EXCLUIDO", contatoId: r?.id ?? ponto.contatoId };
  const c = await cliente.contato.findUniqueOrThrow({ where: { id: r.id }, select: { id: true, nome: true, empresaId: true } });
  return { tipo: "ENCONTRADO", contato: c };
}

export type MatchEmpresa = { empresa: EmpresaEncontrada; via: "cnpj" | "dominio" };

/**
 * CNPJ (alfanumérico, com DV válido) ou domínio (de email, URL ou o próprio).
 *
 * `via` diz por onde casou, e importa: **só `via: "cnpj"` pode virar vínculo
 * automático** (ingestão, LLM, import). Domínio não é chave de identidade no
 * design (§4.2/§4.3) — é SUGESTÃO que exige confirmação humana (ex.: marcar
 * `revisar`). Domínio de provedor pessoal (gmail…) nunca casa; domínio de
 * mais de uma empresa viva é ambíguo → null. Deletada não casa; mesclada
 * resolve para o destino.
 */
export async function encontrarEmpresa(entrada: string, cliente: Cliente = db): Promise<MatchEmpresa | null> {
  const cnpj = normalizarCnpj(entrada);
  let candidatos: string[];
  let via: MatchEmpresa["via"];
  if (cnpj) {
    via = "cnpj";
    candidatos = (await cliente.empresa.findMany({ where: { cnpj }, select: { id: true } })).map((e) => e.id);
  } else {
    const dominio = normalizarDominio(entrada);
    if (!dominio || ehDominioPublico(dominio)) return null;
    via = "dominio";
    candidatos = (await cliente.empresa.findMany({ where: { dominioEmail: dominio, deletadoEm: null }, select: { id: true }, take: 10 })).map((e) => e.id);
  }
  if (candidatos.length === 0) return null;
  const vivas = new Map<string, EmpresaEncontrada>();
  for (const r of (await resolverEmpresas(candidatos, cliente)).values()) {
    if (!r.deletado) vivas.set(r.id, { id: r.id, nome: r.nome });
  }
  return vivas.size === 1 ? { empresa: [...vivas.values()][0], via } : null;
}
