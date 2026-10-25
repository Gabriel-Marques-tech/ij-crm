/**
 * Match por identificador EXATO (design doc §2 anti-objetivo, §4.3 passo 6).
 * É o que a ingestão do WhatsApp e o import usam para reaproveitar
 * Contato/Empresa sem humano no meio — por isso nunca casa por nome, nem
 * aproximado: só valor normalizado igual ao gravado.
 *
 * - `encontrarContatoPorIdentificador("11 9999-8888" | "Ana@Acme.com")`
 * - `encontrarEmpresa("12.ABC.345/01DE-35" | "ana@acme.com.br" | "https://acme.com.br")`
 *
 * Mesclados (`merged_into_id`) resolvem para o destino; soft-deletados não
 * casam. Aceita um cliente de transação para rodar dentro da ingestão.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ehDominioPublico, normalizarCnpj, normalizarDominio, normalizarPonto } from "@/lib/normalizacao";

type Cliente = Prisma.TransactionClient;

export type ContatoEncontrado = { id: string; nome: string; empresaId: string | null };
export type EmpresaEncontrada = { id: string; nome: string };

/** Teto de saltos de merge (merge é manual e raro; evita laço se houver ciclo por erro). */
const MAX_SALTOS = 5;

async function resolverContato(cliente: Cliente, id: string): Promise<ContatoEncontrado | null> {
  let atual = id;
  for (let i = 0; i <= MAX_SALTOS; i++) {
    const c = await cliente.contato.findUnique({ where: { id: atual }, select: { id: true, nome: true, empresaId: true, mergedIntoId: true, deletadoEm: true } });
    if (!c || c.deletadoEm) return null;
    if (!c.mergedIntoId) return { id: c.id, nome: c.nome, empresaId: c.empresaId };
    atual = c.mergedIntoId;
  }
  return null;
}

async function resolverEmpresa(cliente: Cliente, id: string): Promise<EmpresaEncontrada | null> {
  let atual = id;
  for (let i = 0; i <= MAX_SALTOS; i++) {
    const e = await cliente.empresa.findUnique({ where: { id: atual }, select: { id: true, nome: true, mergedIntoId: true, deletadoEm: true } });
    if (!e || e.deletadoEm) return null;
    if (!e.mergedIntoId) return { id: e.id, nome: e.nome };
    atual = e.mergedIntoId;
  }
  return null;
}

/** Telefone ou email (decide pela forma: com `@` é email). Não normaliza → null. */
export async function encontrarContatoPorIdentificador(entrada: string, cliente: Cliente = db): Promise<ContatoEncontrado | null> {
  const p = normalizarPonto(entrada);
  if (!p) return null;
  const ponto = await cliente.contatoPonto.findUnique({
    where: { tipo_valorNormalizado: { tipo: p.tipo, valorNormalizado: p.valorNormalizado } },
    select: { contatoId: true },
  });
  return ponto ? resolverContato(cliente, ponto.contatoId) : null;
}

/**
 * CNPJ (alfanumérico, com DV válido) ou domínio (de email, URL ou o próprio).
 * Domínio de provedor pessoal (gmail…) nunca casa. Domínio compartilhado por
 * mais de uma empresa viva é ambíguo → null (não escolhe por conta própria).
 */
export async function encontrarEmpresa(entrada: string, cliente: Cliente = db): Promise<EmpresaEncontrada | null> {
  const cnpj = normalizarCnpj(entrada);
  if (cnpj) {
    const e = await cliente.empresa.findUnique({ where: { cnpj }, select: { id: true } });
    return e ? resolverEmpresa(cliente, e.id) : null;
  }
  const dominio = normalizarDominio(entrada);
  if (!dominio || ehDominioPublico(dominio)) return null;
  const achadas = await cliente.empresa.findMany({
    where: { dominioEmail: dominio, deletadoEm: null },
    select: { id: true },
    take: 10,
  });
  const resolvidas = new Map<string, EmpresaEncontrada>();
  for (const a of achadas) {
    const r = await resolverEmpresa(cliente, a.id);
    if (r) resolvidas.set(r.id, r);
  }
  return resolvidas.size === 1 ? [...resolvidas.values()][0] : null;
}
