/**
 * GET /tabela/csv — exporta a Tabela (GAB-35) com os mesmos filtros e ordem
 * da URL da tela (página ignorada: vão todas as linhas), em streaming.
 *
 * Qualquer usuário logado (vendedor vê tudo). Erro antes do primeiro byte →
 * 500 com `ref` (causa só no log). Erro no meio do streaming não pode mais
 * virar 500 (o status 200 já saiu): a última linha do arquivo vira
 * "EXPORTAÇÃO INCOMPLETA: erro no servidor (ref: …)". Limitação aceita para
 * uso manual no Excel: o download "termina bem" e é essa linha final que
 * sinaliza o arquivo truncado; quem consumir o CSV por script precisa
 * checá-la.
 */
import { unstable_rethrow } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/atual";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";
import { diaEmFuso } from "@/lib/projetos/aging";
import { lerEstado } from "@/lib/tabela/params";
import { exportarCsv } from "@/lib/tabela/tabela";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTEXTO = "tabela/csv";

export async function GET(req: Request): Promise<Response> {
  await exigirUsuario();
  const agora = new Date();
  const { filtros, ordem } = lerEstado(new URL(req.url).searchParams);
  const pedacos = exportarCsv(filtros, ordem, agora);

  let primeiro: IteratorResult<string>;
  try {
    primeiro = await pedacos.next();
  } catch (e) {
    unstable_rethrow(e);
    const ref = registrarErro(CONTEXTO, e);
    return new Response(mensagemInesperada(ref), { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  const cod = new TextEncoder();
  let pendente: string | null = primeiro.done ? null : primeiro.value;
  const corpo = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (pendente !== null) {
        ctrl.enqueue(cod.encode(pendente));
        pendente = null;
        return;
      }
      try {
        const r = await pedacos.next();
        if (r.done) ctrl.close();
        else ctrl.enqueue(cod.encode(r.value));
      } catch (e) {
        const ref = registrarErro(CONTEXTO, e);
        ctrl.enqueue(cod.encode(`\r\nEXPORTAÇÃO INCOMPLETA: erro no servidor (ref: ${ref})\r\n`));
        ctrl.close();
      }
    },
    async cancel() {
      await pedacos.return(undefined);
    },
  });

  return new Response(corpo, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="projetos-${diaEmFuso(agora)}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
