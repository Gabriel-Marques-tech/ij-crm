/**
 * Campos editáveis de Empresa e Contato e a interpretação da string que vem
 * do formulário. Puro: o serviço grava (e checa unicidade); aqui só se
 * decide o valor. Identificadores passam pela normalização compartilhada.
 */
import { ehDominioPublico, normalizarCnpj, normalizarDominio } from "@/lib/normalizacao";
import { UFS } from "@/lib/oportunidades/campos";

export const NOME_MAX = 200;

/** Nome de empresa/contato: aparado, espaços colapsados, 1..200 caracteres. */
export function validarNome(nome: string): string | null {
  const t = nome.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= NOME_MAX ? t : null;
}

export const CAMPOS_EMPRESA = ["nome", "cnpj", "dominioEmail", "cidade", "estado", "site", "observacoes"] as const;
export type CampoEmpresa = (typeof CAMPOS_EMPRESA)[number];

export const CAMPOS_CONTATO = ["nome", "cargo", "observacoes"] as const;
export type CampoContato = (typeof CAMPOS_CONTATO)[number];

export function ehCampoEmpresa(c: string): c is CampoEmpresa {
  return (CAMPOS_EMPRESA as readonly string[]).includes(c);
}

export function ehCampoContato(c: string): c is CampoContato {
  return (CAMPOS_CONTATO as readonly string[]).includes(c);
}

export type ResultadoCampo = { ok: true; valor: string | null } | { ok: false; erro: string };

function textoOpcional(bruto: string, max: number, rotulo: string): ResultadoCampo {
  const t = bruto.trim();
  if (t === "") return { ok: true, valor: null };
  if (t.length > max) return { ok: false, erro: `${rotulo}: no máximo ${max} caracteres.` };
  return { ok: true, valor: t };
}

function nome(bruto: string): ResultadoCampo {
  const n = validarNome(bruto);
  return n ? { ok: true, valor: n } : { ok: false, erro: `Nome precisa ter entre 1 e ${NOME_MAX} caracteres.` };
}

export function interpretarCnpj(bruto: string): ResultadoCampo {
  if (bruto.trim() === "") return { ok: true, valor: null };
  const c = normalizarCnpj(bruto);
  return c ? { ok: true, valor: c } : { ok: false, erro: "CNPJ inválido: confira os 14 caracteres e os dígitos verificadores." };
}

export function interpretarDominio(bruto: string): ResultadoCampo {
  if (bruto.trim() === "") return { ok: true, valor: null };
  const d = normalizarDominio(bruto);
  if (!d) return { ok: false, erro: "Domínio inválido. Ex.: acme.com.br (pode colar um email ou o site)." };
  if (ehDominioPublico(d)) return { ok: false, erro: `${d} é um provedor de email pessoal: não identifica a empresa.` };
  return { ok: true, valor: d };
}

function site(bruto: string): ResultadoCampo {
  const t = bruto.trim();
  if (t === "") return { ok: true, valor: null };
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(comEsquema);
    if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") && comEsquema.length <= 500) return { ok: true, valor: comEsquema };
  } catch {
    /* cai no erro */
  }
  return { ok: false, erro: "Site inválido. Ex.: acme.com.br" };
}

export function interpretarCampoEmpresa(campo: CampoEmpresa, bruto: string): ResultadoCampo {
  switch (campo) {
    case "nome":
      return nome(bruto);
    case "cnpj":
      return interpretarCnpj(bruto);
    case "dominioEmail":
      return interpretarDominio(bruto);
    case "cidade":
      return textoOpcional(bruto, 100, "Cidade");
    case "estado": {
      const t = bruto.trim().toUpperCase();
      if (t === "") return { ok: true, valor: null };
      return (UFS as readonly string[]).includes(t) ? { ok: true, valor: t } : { ok: false, erro: "Estado: use a sigla da UF (ex.: SP)." };
    }
    case "site":
      return site(bruto);
    case "observacoes":
      return textoOpcional(bruto, 5000, "Observações");
  }
}

export function interpretarCampoContato(campo: CampoContato, bruto: string): ResultadoCampo {
  switch (campo) {
    case "nome":
      return nome(bruto);
    case "cargo":
      return textoOpcional(bruto, 100, "Cargo");
    case "observacoes":
      return textoOpcional(bruto, 5000, "Observações");
  }
}
