import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { ConfigAusente, ConfigFraca, notificacoesAtivas } from "@/lib/config/env";
import { CONFIG_TECNICA, resolverConfigTecnica, validarCombinacao } from "@/lib/config/tecnica";
import { obterConfiguracao } from "@/lib/configuracao/servico";
import { comTratamento, ehInesperado, registrarErro } from "@/lib/erros/registrar";
import { contarOutroChatUltimaHora } from "@/lib/logs/tecnicos";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { nomesDeUsuarios } from "@/lib/oportunidades/oportunidades";
import { ErroEvolutionAdmin, estadoConexao, type EstadoConexao } from "@/lib/whatsapp/evolution-admin";
import { AbasAdmin } from "./abas";
import { ConfigTecnicaForm } from "./config-form";
import { situacaoSafeMode } from "./safe-mode";
import { estadoSegredos } from "./segredos";
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

/** Admin → Configuração (GAB-42): grupo, LLM, limiares e timeout sem deploy; segredos e safe mode só leitura. */
export default async function AdminConfigPage() {
  await exigirPapel("ADMIN");
  const dados = await comTratamento("pagina.admin.config", async () => {
    const c = await obterConfiguracao(CONFIG_TECNICA);
    const autor = c.atualizadoPor ? ((await nomesDeUsuarios([c.atualizadoPor])).get(c.atualizadoPor) ?? null) : null;
    const outroChat = await contarOutroChatUltimaHora();
    return { c, autor, outroChat };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { c, autor, outroChat } = dados;
  const herdado = resolverConfigTecnica({});
  const efetivo = resolverConfigTecnica(c.valor);
  // Mesma regra da carga (tecnica.ts): combinação salva inválida é ignorada e vale só o env.
  const ignorada = c.padrao ? null : (validarCombinacao(efetivo) ?? (efetivo.grupoJid.valor ? null : "sem GRUPO_JID"));
  const safe = situacaoSafeMode({ producao: process.env.NODE_ENV === "production", enviando: notificacoesAtivas() });
  const evo = await conexao();

  return (
    <>
      <PageHeader eyebrow="gestão · admin" title="Admin" description="Configuração técnica do WhatsApp e da LLM. Vale na próxima mensagem, sem deploy." />
      <AbasAdmin atual="/gestao/admin" />
      <div className="max-w-3xl space-y-4">
        <StatusEvolution conexao={evo} />

        <section className={`rounded-xl border bg-surface p-5 ${safe.aviso ? "border-l-2 border-border border-l-warn" : "border-border"}`}>
          <p className="eyebrow mb-2">
            safe mode (só leitura, do ambiente) · ambiente: <span className="font-mono">{safe.ambiente}</span>
          </p>
          <p className={`text-sm ${safe.aviso ? "text-warn" : ""}`} role={safe.aviso ? "alert" : undefined}>
            <span className="font-medium">{safe.titulo}</span> — {safe.texto}
          </p>
        </section>

        {outroChat > 0 ? (
          <p role="alert" className="rounded-xl border border-l-2 border-border border-l-warn bg-surface p-4 text-sm text-warn">
            <span className="font-mono">{outroChat}</span> {outroChat === 1 ? "evento" : "eventos"} de outro chat na última hora (dos últimos registrados em Logs). Se as
            mensagens do grupo não estão entrando, confira o GRUPO_JID.
          </p>
        ) : null}

        <section className="rounded-xl border border-border bg-surface p-5">
          <p className="eyebrow mb-3">segredos (só no ambiente, nunca editáveis aqui)</p>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {estadoSegredos().map((s) => (
              <li key={s.nome} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-fg-soft">{s.nome}</span>
                <span className={s.estado === "configurada" ? "text-success" : s.estado === "fraca" ? "text-warn" : "text-danger"}>{s.estado}</span>
              </li>
            ))}
          </ul>
        </section>

        {ignorada ? (
          <p role="alert" className="rounded-xl border border-l-2 border-border border-l-danger bg-surface p-4 text-sm text-danger">
            A configuração salva aqui está sendo <span className="font-medium">ignorada</span> (vale só o ambiente): {ignorada} Corrija e salve, ou apague.
          </p>
        ) : null}
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
