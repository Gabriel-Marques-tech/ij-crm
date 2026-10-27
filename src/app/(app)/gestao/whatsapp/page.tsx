import Link from "next/link";
import { EstadoVazio } from "@/components/estado-vazio";
import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { carregarPainel, listarFila, opcoesDoPainel, type ItemFila } from "@/lib/whatsapp/painel";
import { AcoesMensagem } from "./acoes-mensagem";
import { VincularRemetente } from "./vincular-remetente";

export const metadata = { title: "WhatsApp · Gestão" };

const TH = "eyebrow px-3 py-2 font-normal";
const TD = "px-3 py-2";
const LINK = "text-primary hover:underline";

/** Motivo legível: PENDENTE traz `aplicacao.motivo` no resultado_llm; FALHA traz `erro` (código + ref). */
function motivo(m: ItemFila): string | null {
  if (m.status === "FALHA") return m.erro;
  const ap = (m.resultadoLlm as { aplicacao?: { motivo?: unknown } } | null)?.aplicacao;
  return typeof ap?.motivo === "string" ? ap.motivo : m.erro;
}

function Secao({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">{titulo}</p>
        {extra}
      </div>
      {children}
    </section>
  );
}

/**
 * Gestão → WhatsApp (GAB-41, GESTOR+). Fila de FALHA/PENDENTE_REVISAO com
 * texto, remetente, motivo e o JSON da LLM; reprocessar (mesma função do cron)
 * ou resolver manualmente; contadores diários do que não foi guardado;
 * remetentes desconhecidos (mascarados, sem conteúdo) e as 50 últimas
 * processadas com link para o card. Logs técnicos ficam no Admin (GAB-42).
 */
export default async function WhatsappPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const ator = await exigirPapel("GESTOR");
  const pagina = Number.parseInt((await searchParams).pagina ?? "1", 10) || 1;
  const dados = await comTratamento("pagina.gestao.whatsapp", async () => {
    const [fila, painel, opcoes] = await Promise.all([listarFila(pagina), carregarPainel(), opcoesDoPainel()]);
    return { fila, painel, opcoes };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { fila, painel, opcoes } = dados;
  const nFalha = painel.contagem.FALHA ?? 0;
  const nPendente = painel.contagem.PENDENTE_REVISAO ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="gestão"
        title="WhatsApp"
        description="Mensagens que não viraram card sozinhas, o que foi descartado e quem mandou mensagem sem estar cadastrado. O cron reprocessa falhas sozinho a cada 10 min (até 3 tentativas)."
      />
      <p className="mb-8 text-sm text-fg-soft">
        <span className="font-mono tabular text-danger">{nFalha}</span> com falha ·{" "}
        <span className="font-mono tabular text-warn">{nPendente}</span> pendentes de revisão
        {ator.papel === "ADMIN" ? (
          <>
            {" "}
            · <Link href="/gestao/admin/logs" className={LINK}>logs técnicos (webhook e LLM)</Link>
          </>
        ) : null}
      </p>

      <Secao
        titulo="fila"
        extra={
          fila.paginas > 1 ? (
            <nav className="flex items-center gap-3 font-mono text-xs tabular text-fg-mute" aria-label="Páginas da fila">
              {fila.pagina > 1 ? <Link href={`?pagina=${fila.pagina - 1}`} className={LINK}>← anterior</Link> : null}
              <span>
                {fila.pagina}/{fila.paginas}
              </span>
              {fila.pagina < fila.paginas ? <Link href={`?pagina=${fila.pagina + 1}`} className={LINK}>próxima →</Link> : null}
            </nav>
          ) : null
        }
      >
        {fila.itens.length === 0 ? (
          <EstadoVazio
            mascote="piscando"
            titulo="Fila zerada"
            texto="Nenhuma mensagem do grupo esperando revisão."
            className="rounded-xl border border-border bg-surface"
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {fila.itens.map((m) => {
              const mot = motivo(m);
              return (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-xs text-fg-mute">
                      <span className={m.status === "FALHA" ? "text-danger" : "text-warn"}>{m.status === "FALHA" ? "falha" : "pendente"}</span> ·{" "}
                      <span className="text-fg-soft">{m.remetente}</span> · <span className="font-mono tabular">{formatarDataHora(m.recebidaEm)}</span> ·{" "}
                      <span className="font-mono tabular">{m.tentativas}</span> tentativa{m.tentativas === 1 ? "" : "s"}
                      {m.semTag ? " · sem #crm" : ""}
                    </p>
                    <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm whitespace-pre-wrap text-foreground">{m.texto}</p>
                    {mot ? (
                      <p className="text-xs text-fg-mute">
                        Motivo: <span className="font-mono text-fg-soft">{mot}</span>
                      </p>
                    ) : null}
                    {m.resultadoLlm ? (
                      <details className="group rounded-lg border border-border bg-surface/60 text-xs">
                        <summary className="cursor-pointer list-none px-3 py-1.5 text-fg-mute select-none hover:text-foreground">
                          <span className="group-open:hidden">▸</span>
                          <span className="hidden group-open:inline">▾</span> Leitura da LLM
                        </summary>
                        <pre className="max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-soft">
                          {JSON.stringify(m.resultadoLlm, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                  <AcoesMensagem id={m.id} texto={m.texto} fases={opcoes.fases} />
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      <div className="grid gap-x-8 lg:grid-cols-2">
        <Secao titulo="descartadas por dia (14 dias)">
          {painel.contadores.length === 0 ? (
            <p className="text-sm text-fg-mute">Nada descartado ainda.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={TH}>dia</th>
                    <th className={`${TH} text-right`}>descartadas</th>
                    <th className={`${TH} text-right`} title="Sem #crm e o classificador falhou (ex.: sem crédito). O texto não foi guardado.">
                      não classificadas
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs tabular">
                  {painel.contadores.map((c) => (
                    <tr key={c.dia} className="border-b border-border last:border-0">
                      <td className={TD}>{c.dia.split("-").reverse().join("/")}</td>
                      <td className={`${TD} text-right`}>{c.total}</td>
                      <td className={`${TD} text-right ${c.naoClassificadas ? "text-warn" : ""}`}>{c.naoClassificadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Secao>

        <Secao titulo="remetentes desconhecidos">
          {painel.desconhecidos.length === 0 ? (
            <p className="text-sm text-fg-mute">Ninguém de fora do cadastro mandou mensagem.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {painel.desconhecidos.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <div className="text-xs">
                    <p className="font-mono text-sm text-foreground">{d.mascarado}</p>
                    <p className="text-fg-mute">
                      {d.tipo === "lid" ? "LID" : "telefone"} · <span className="font-mono tabular">{d.total}</span> mensage{d.total === 1 ? "m" : "ns"} · última{" "}
                      <span className="font-mono tabular">{formatarDataHora(d.ultimaVez)}</span>
                    </p>
                  </div>
                  <VincularRemetente remetenteId={d.id} usuarios={opcoes.usuarios} />
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      <Secao titulo="últimas 50 processadas">
        {painel.recentes.length === 0 ? (
          <p className="text-sm text-fg-mute">Nenhuma mensagem processada ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={TH}>quando</th>
                  <th className={TH}>de</th>
                  <th className={TH}>mensagem</th>
                  <th className={TH}>card</th>
                </tr>
              </thead>
              <tbody>
                {painel.recentes.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className={`${TD} font-mono text-xs whitespace-nowrap tabular`}>{formatarDataHora(r.recebidaEm)}</td>
                    <td className={`${TD} text-xs whitespace-nowrap`}>{r.remetente}</td>
                    <td className={`${TD} max-w-md text-xs text-fg-soft`}>
                      <span className="line-clamp-2">{r.texto}</span>
                      {r.resolvidaPor ? <span className="text-fg-mute"> (resolvida à mão por {r.resolvidaPor})</span> : null}
                    </td>
                    <td className={`${TD} text-xs`}>
                      {r.card && !r.card.excluido ? (
                        <Link href={`/kanban/${encodeURIComponent(r.card.id)}`} className={LINK}>
                          {r.card.titulo}
                        </Link>
                      ) : r.card ? (
                        <span className="text-fg-mute">{r.card.titulo} (na lixeira)</span>
                      ) : (
                        <span className="text-fg-mute">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </>
  );
}
