import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { LIMITE_LOG_LLM, LIMITE_LOG_WEBHOOK, listarLogsLlm, listarLogsWebhook } from "@/lib/logs/tecnicos";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { AbasAdmin } from "../abas";

export const metadata = { title: "Logs · Admin" };

const TH = "eyebrow px-3 py-2 font-normal";
const TD = "px-3 py-2";
const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR"));

function corStatus(ok: boolean) {
  return ok ? "text-success" : "text-danger";
}

/** Admin → Logs (GAB-42): últimas chamadas do webhook e da LLM. Sem conteúdo de mensagem. */
export default async function AdminLogsPage() {
  await exigirPapel("ADMIN");
  const dados = await comTratamento("pagina.admin.logs", async () => {
    const [webhook, llm] = await Promise.all([listarLogsWebhook(), listarLogsLlm()]);
    return { webhook, llm };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { webhook, llm } = dados;

  return (
    <>
      <PageHeader
        eyebrow="gestão · admin"
        title="Admin"
        description={`Últimos ${LIMITE_LOG_WEBHOOK} eventos do webhook e ${LIMITE_LOG_LLM} chamadas de LLM (os mais antigos são apagados). Sem texto de mensagem; chats mascarados. Detalhes de erro: procure a ref no log do servidor.`}
      />
      <AbasAdmin atual="/gestao/admin/logs" />

      <section className="mb-8">
        <p className="eyebrow mb-3">chamadas de llm</p>
        {llm.length === 0 ? (
          <p className="text-sm text-fg-mute">Nenhuma chamada registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={TH}>quando</th>
                  <th className={TH}>operação</th>
                  <th className={TH}>modelo</th>
                  <th className={`${TH} text-right`}>entrada</th>
                  <th className={`${TH} text-right`}>saída</th>
                  <th className={`${TH} text-right`}>raciocínio</th>
                  <th className={`${TH} text-right`}>ms</th>
                  <th className={TH}>status</th>
                  <th className={TH}>ref</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs tabular">
                {llm.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className={`${TD} whitespace-nowrap`}>{formatarDataHora(l.em)}</td>
                    <td className={TD}>{l.operacao}</td>
                    <td className={TD}>{l.modelo ?? l.provedor ?? "—"}</td>
                    <td className={`${TD} text-right`}>{n(l.tokensEntrada)}</td>
                    <td className={`${TD} text-right`}>{n(l.tokensSaida)}</td>
                    <td className={`${TD} text-right`}>{n(l.tokensRaciocinio)}</td>
                    <td className={`${TD} text-right`}>{n(l.ms)}</td>
                    <td className={`${TD} ${corStatus(l.status === "ok")}`}>{l.status}</td>
                    <td className={`${TD} text-fg-mute`}>{l.ref ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <p className="eyebrow mb-3">webhook</p>
        {webhook.length === 0 ? (
          <p className="text-sm text-fg-mute">Nenhum evento registrado ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={TH}>quando</th>
                  <th className={TH}>tipo</th>
                  <th className={TH}>chat</th>
                  <th className={TH}>http</th>
                  <th className={TH}>resultado</th>
                  <th className={`${TH} text-right`}>ms</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs tabular">
                {webhook.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className={`${TD} whitespace-nowrap`}>{formatarDataHora(w.em)}</td>
                    <td className={TD}>{w.tipo ?? "—"}</td>
                    <td className={TD}>{w.chat ?? "—"}</td>
                    <td className={`${TD} ${corStatus(w.status < 400)}`}>{w.status}</td>
                    <td className={TD}>{w.resultado}</td>
                    <td className={`${TD} text-right`}>{n(w.ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
