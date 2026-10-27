/**
 * Upload do CSV do Pipefy → prévia (GAB-37). Route handler (e não server
 * action) para não subir o limite global de corpo das actions: só esta rota
 * aceita até `LIMITE_BYTES`.
 *
 * Ordem: sessão e papel PRIMEIRO (401/403 em JSON, sem redirect e sem ler o
 * corpo), origem do mesmo site, Content-Length acima do limite → 413; sem
 * Content-Length (chunked) os bytes são contados no streaming e a leitura é
 * abortada ao passar do limite. Corpo = o arquivo cru; nome no header
 * `X-Nome-Arquivo` (encodeURIComponent).
 */
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth/atual";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { registrarErro } from "@/lib/erros/registrar";
import { decodificarArquivo } from "@/lib/importacao/pipefy/csv";
import { LIMITE_BYTES, criarPrevia } from "@/lib/importacao/pipefy/servico";

const MB = (n: number) => (n / 1024 / 1024).toFixed(1).replace(".", ",");

const falha = (status: number, erro: string, ref?: string) => NextResponse.json(ref ? { ok: false, erro, ref } : { ok: false, erro }, { status });

const grandeDemais = (tamanho: string) =>
  falha(413, `Arquivo com ${tamanho} MB; o limite é ${MB(LIMITE_BYTES)} MB. Divida o export (por fase ou período) ou use o CLI.`);

/** Lê o corpo contando bytes; `null` = passou do limite (leitura cancelada). */
async function lerCorpo(req: Request, limite: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.byteLength;
  }
  return tudo;
}

function mesmoSite(req: Request): boolean {
  const origem = req.headers.get("origin");
  if (!origem) return true; // navegador sempre manda em POST cross-site; ausência = mesmo site/ferramenta
  try {
    return new URL(origem).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const u = await usuarioAtual();
    if (!u) return falha(401, "Sessão expirada. Entre de novo.");
    if (!temPapelMinimo(u.papel, "GESTOR")) return falha(403, "Só gestor ou admin importa do Pipefy.");
    if (!mesmoSite(req)) return falha(403, "Origem não permitida.");

    let nome = "";
    try {
      nome = decodeURIComponent(req.headers.get("x-nome-arquivo") ?? "").slice(0, 255);
    } catch {
      return falha(400, "Nome de arquivo inválido.");
    }
    if (/\.xlsx?$/i.test(nome)) return falha(400, "Arquivo do Excel (.xlsx). Abra no Excel/Planilhas e salve como CSV (UTF-8), depois envie o .csv.");
    if (nome && !/\.(csv|txt)$/i.test(nome)) return falha(400, "Envie o export em CSV (.csv).");

    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) return grandeDemais(MB(declarado));
    const bytes = await lerCorpo(req, LIMITE_BYTES);
    if (bytes === null) return grandeDemais(`mais de ${MB(LIMITE_BYTES)}`);
    if (!nome || bytes.byteLength === 0) return falha(400, "Escolha o arquivo CSV exportado do Pipefy.");

    const r = await criarPrevia({ conteudo: decodificarArquivo(bytes), nomeArquivo: nome }, u);
    if (!r.ok) return falha(422, r.erro);
    return NextResponse.json({ ok: true, token: r.token, expiraEm: r.expiraEm.toISOString(), previa: r.previa });
  } catch (e) {
    return falha(500, "INESPERADO", registrarErro("api.gestao.importar.previa", e));
  }
}
