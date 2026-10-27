import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { chaveAnthropic, chaveOpenAI, ConfigAusente, ConfigFraca, diagnosticarSegredo, notificacoesAtivas } from "@/lib/config/env";
import { CONFIG_TECNICA, resolverConfigTecnica } from "@/lib/config/tecnica";
import { obterConfiguracao } from "@/lib/configuracao/servico";
import { comTratamento, ehInesperado, registrarErro } from "@/lib/erros/registrar";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { nomesDeUsuarios } from "@/lib/oportunidades/oportunidades";
import { ErroEvolutionAdmin, estadoConexao, type EstadoConexao } from "@/lib/whatsapp/evolution-admin";
import { AbasAdmin } from "./abas";
import { ConfigTecnicaForm } from "./config-form";
import { StatusEvolution } from "./status-evolution";

export const metadata = { title: "Admin · Gestão" };

type Conexao = { ok: true; estado: EstadoConexao } | { ok: false; erro: string };

/** Estado da instância sem travar a página: 5 s de timeout; erro esperado vira frase, o resto vai com ref. */
async function conexao(): Promise<Conexao> {
  try {
    return { ok: true, estado: await estadoConexao(5_000) };
  } catch (e) {
    if (e instanceof ErroEvolutionAdmin) return { ok: false, erro: e.message };
    if (e instanceof ConfigAusente || e instanceof ConfigFraca) return { ok: false, erro: `Evolution não configurada (${e.variavel}).` };
    return { ok: false, erro: `Erro no servidor (ref: ${registrarErro("pagina.admin.evolution", e)}).` };
  }
}

function segredos() {
  const forte = (nome: string) => {
    const d = diagnosticarSegredo(nome);
    return d.ok ? "configurada" : d.motivo === "AUSENTE" ? "ausente" : "fraca";
  };
  const presente = (v: string | undefined) => (v ? "configurada" : "ausente");
  return [
    { nome: "OPENAI_API_KEY", estado: presente(chaveOpenAI()) },
    { nome: "ANTHROPIC_API_KEY", estado: presente(chaveAnthropic()) },
    { nome: "EVOLUTION_API_KEY", estado: forte("EVOLUTION_API_KEY") },
    { nome: "EVOLUTION_WEBHOOK_SECRET", estado: forte("EVOLUTION_WEBHOOK_SECRET") },
    { nome: "EVOLUTION_API_URL", estado: presente(process.env.EVOLUTION_API_URL?.trim()) },
    { nome: "EVOLUTION_INSTANCE", estado: presente(process.env.EVOLUTION_INSTANCE?.trim()) },
  ] as const;
}

/** Admin → Configuração (GAB-42): grupo, LLM, limiares e timeout sem deploy; segredos e safe mode só leitura. */
export default async function AdminConfigPage() {
  await exigirPapel("ADMIN");
  const dados = await comTratamento("pagina.admin.config", async () => {
    const c = await obterConfiguracao(CONFIG_TECNICA);
    const autor = c.atualizadoPor ? ((await nomesDeUsuarios([c.atualizadoPor])).get(c.atualizadoPor) ?? null) : null;
    return { c, autor };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { c, autor } = dados;
  const herdado = resolverConfigTecnica({});
  const efetivo = resolverConfigTecnica(c.valor);
  const safe = !notificacoesAtivas();
  const evo = await conexao();

  return (
    <>
      <PageHeader eyebrow="gestão · admin" title="Admin" description="Configuração técnica do WhatsApp e da LLM. Vale na próxima mensagem, sem deploy." />
      <AbasAdmin atual="/gestao/admin" />
      <div className="max-w-3xl space-y-4">
        <StatusEvolution conexao={evo} />

        <section className={`rounded-xl border bg-surface p-5 ${safe ? "border-border" : "border-l-2 border-border border-l-warn"}`}>
          <p className="eyebrow mb-2">safe mode (só leitura, do ambiente)</p>
          {safe ? (
            <p className="text-sm">
              <span className="font-medium">Ligado</span> — <span className="font-mono">NOTIFICATIONS_ENABLED</span> não é <span className="font-mono">true</span>: o CRM processa as mensagens, mas não responde nada no grupo.
            </p>
          ) : (
            <p role="alert" className="text-sm text-warn">
              <span className="font-medium">Desligado</span> — o bot envia mensagens reais ao grupo do WhatsApp. Para pausar, defina <span className="font-mono">NOTIFICATIONS_ENABLED=false</span> no ambiente e reinicie.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <p className="eyebrow mb-3">segredos (só no ambiente, nunca editáveis aqui)</p>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {segredos().map((s) => (
              <li key={s.nome} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-fg-soft">{s.nome}</span>
                <span className={s.estado === "configurada" ? "text-success" : s.estado === "fraca" ? "text-warn" : "text-danger"}>{s.estado}</span>
              </li>
            ))}
          </ul>
        </section>

        {c.invalido ? (
          <p role="alert" className="font-mono text-xs text-warn">
            valor salvo inválido — usando o ambiente. Salve para corrigir.
          </p>
        ) : c.atualizadoEm ? (
          <p className="font-mono text-xs text-fg-mute">
            alterado em {formatarDataHora(c.atualizadoEm)}
            {autor ? ` por ${autor}` : ""}
          </p>
        ) : (
          <p className="font-mono text-xs text-fg-mute">nada salvo aqui: tudo vem do ambiente</p>
        )}
        <ConfigTecnicaForm atual={c.valor} herdado={herdado} efetivo={efetivo} versao={c.atualizadoEm?.getTime() ?? null} />
      </div>
    </>
  );
}
