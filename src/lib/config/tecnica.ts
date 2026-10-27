/**
 * Configuração técnica do Admin (GAB-42): grupo, provedor/modelos de LLM,
 * limiares e timeout de envio, editáveis sem deploy. Fica na tabela
 * `configuracao` (chave `tecnica`, GAB-44) e é aplicada como sobrescrita das
 * variáveis de ambiente (`sobrescritas.ts`): todas as leituras de `env.ts`
 * seguem **config > env > padrão**, com as validações de lá.
 *
 * Cache: a linha é lida uma vez por processo (`carregarConfigTecnica`, chamada
 * na entrada do webhook e do `processarMensagem`) e fica em memória. Salvar ou
 * restaurar pelo Admin aplica o valor novo na hora, então vale já na próxima
 * mensagem. Isso basta porque o app roda num processo Next só (compose.prod);
 * com mais de um processo seria preciso TTL ou LISTEN/NOTIFY. Edição manual da
 * linha no banco só vale depois de reiniciar o app.
 *
 * Segredos (chaves de API, chave da Evolution, segredo do webhook) e o safe
 * mode (`NOTIFICATIONS_ENABLED`) NÃO entram aqui: continuam só no env.
 */
import { z } from "zod";
import type { Papel } from "@prisma/client";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { definirConfiguracao } from "@/lib/configuracao/definicao";
import { obterConfiguracao, restaurarConfiguracao, salvarConfiguracao } from "@/lib/configuracao/servico";
import { registrarErro } from "@/lib/erros/registrar";
import { LIMIAR_CONFIANCA_PADRAO, MODELOS_EXTRACAO_PADRAO, TIMEOUT_ENVIO_MAX_MS, TIMEOUT_ENVIO_MIN_MS, TIMEOUT_ENVIO_PADRAO_MS } from "./env";
import { definirSobrescritas } from "./sobrescritas";

/** Campo da config → variável de ambiente que ele sobrescreve. */
export const VARIAVEIS_TECNICAS = {
  grupoJid: "GRUPO_JID",
  provedor: "LLM_PROVEDOR",
  modeloExtracao: "LLM_EXTRACAO_MODELO",
  modeloClassificacao: "LLM_CLASSIFICACAO_MODELO",
  limiarConfianca: "LLM_LIMIAR_CONFIANCA",
  limiarSemTag: "LLM_LIMIAR_SEM_TAG",
  limiarClassificador: "LLM_LIMIAR_CLASSIFICADOR",
  timeoutEnvioMs: "EVOLUTION_TIMEOUT_ENVIO_MS",
} as const;

export type CampoTecnico = keyof typeof VARIAVEIS_TECNICAS;

/** Padrões do classificador sem #crm (os mesmos do GAB-39). */
export const LIMIAR_SEM_TAG_PADRAO_TECNICO = 0.85;
export const LIMIAR_CLASSIFICADOR_PADRAO_TECNICO = 0.7;

const PROVEDORES = ["openai", "anthropic", "mock"] as const;
type Provedor = (typeof PROVEDORES)[number];

const limiar = (rotulo: string) =>
  z.number({ error: `${rotulo}: informe um número de 0 a 1.` }).min(0, `${rotulo}: mínimo 0.`).max(1, `${rotulo}: máximo 1.`);
const modelo = (rotulo: string) => z.string().trim().regex(/^[\w.:\-]{1,80}$/, `${rotulo}: só letras, números, ponto, hífen e dois-pontos.`);

/** Todos opcionais: campo ausente = vale o env (ou o padrão). */
const schemaTecnica = z.object({
  grupoJid: z
    .string()
    .trim()
    .regex(/^[\d-]{5,40}@g\.us$/, "Grupo: o JID precisa terminar em @g.us (use \"Listar grupos\")."),
  provedor: z.enum(PROVEDORES, { error: "Provedor: openai, anthropic ou mock." }),
  modeloExtracao: modelo("Modelo de extração"),
  modeloClassificacao: modelo("Modelo de classificação"),
  limiarConfianca: limiar("Limiar com #crm"),
  limiarSemTag: limiar("Limiar sem #crm"),
  limiarClassificador: limiar("Limiar do classificador"),
  timeoutEnvioMs: z
    .number({ error: "Timeout de envio: informe um número." })
    .int("Timeout de envio: número inteiro de milissegundos.")
    .min(TIMEOUT_ENVIO_MIN_MS, `Timeout de envio: mínimo ${TIMEOUT_ENVIO_MIN_MS / 1000} s.`)
    .max(TIMEOUT_ENVIO_MAX_MS, `Timeout de envio: máximo ${TIMEOUT_ENVIO_MAX_MS / 1000} s.`),
}).partial();

export type ConfigTecnica = z.infer<typeof schemaTecnica>;

export const CONFIG_TECNICA = definirConfiguracao<ConfigTecnica>("tecnica", schemaTecnica, {});

/** Config salva → mapa variável → string para `env.ts`. Só os campos definidos. */
export function paraSobrescritas(cfg: ConfigTecnica): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [campo, variavel] of Object.entries(VARIAVEIS_TECNICAS) as [CampoTecnico, string][]) {
    const v = cfg[campo];
    if (v !== undefined && v !== "") mapa[variavel] = String(v);
  }
  return mapa;
}

// ------------------------------------------------------------- valor efetivo

export type Origem = "config" | "env" | "padrao";
export type ValorEfetivo<T> = { valor: T; origem: Origem };
export type ConfigTecnicaEfetiva = {
  grupoJid: ValorEfetivo<string | null>;
  /** `string` quando o env tem um provedor inválido (o pipeline falha; o Admin mostra). */
  provedor: ValorEfetivo<Provedor | string>;
  modeloExtracao: ValorEfetivo<string | null>;
  modeloClassificacao: ValorEfetivo<string | null>;
  limiarConfianca: ValorEfetivo<number>;
  limiarSemTag: ValorEfetivo<number>;
  limiarClassificador: ValorEfetivo<number>;
  timeoutEnvioMs: ValorEfetivo<number>;
};

type Env = Record<string, string | undefined>;
const lerEnv = (env: Env, nome: string) => env[nome]?.trim() || undefined;

function limiarEnv(env: Env, nome: string): number | undefined {
  const bruto = lerEnv(env, nome);
  if (bruto === undefined) return undefined;
  const n = Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

function escolher<T>(config: T | undefined, env: T | undefined, padrao: T): ValorEfetivo<T> {
  if (config !== undefined) return { valor: config, origem: "config" };
  if (env !== undefined) return { valor: env, origem: "env" };
  return { valor: padrao, origem: "padrao" };
}

const ehModeloAnthropic = (m: string) => m.startsWith("claude-");
const modeloCombina = (m: string, p: string) => (p === "anthropic" ? ehModeloAnthropic(m) : p === "openai" ? !ehModeloAnthropic(m) : true);

/**
 * O que está valendo, campo a campo, e de onde veio. Espelha as leituras de
 * `env.ts` (mesmo parse; env ilegível = padrão). Pura: `env` injetável.
 */
export function resolverConfigTecnica(cfg: ConfigTecnica, env: Env = process.env): ConfigTecnicaEfetiva {
  const provedor = escolher<string>(cfg.provedor, lerEnv(env, "LLM_PROVEDOR")?.toLowerCase(), "openai");
  const p = provedor.valor;
  const padraoModelo = p === "openai" || p === "anthropic" ? MODELOS_EXTRACAO_PADRAO[p] : null;
  const modeloExtracao = escolher<string | null>(cfg.modeloExtracao, lerEnv(env, "LLM_EXTRACAO_MODELO"), padraoModelo);
  // Como o GAB-39: modelo de classificação de outro provedor vindo do env é ignorado (usa o da extração).
  const classifEnv = lerEnv(env, "LLM_CLASSIFICACAO_MODELO");
  const modeloClassificacao = escolher<string | null>(
    cfg.modeloClassificacao,
    classifEnv && modeloCombina(classifEnv, p) ? classifEnv : undefined,
    modeloExtracao.valor,
  );
  const timeoutEnv = Number(lerEnv(env, "EVOLUTION_TIMEOUT_ENVIO_MS"));
  return {
    grupoJid: escolher<string | null>(cfg.grupoJid, lerEnv(env, "GRUPO_JID"), null),
    provedor: provedor as ConfigTecnicaEfetiva["provedor"],
    modeloExtracao,
    modeloClassificacao,
    limiarConfianca: escolher(cfg.limiarConfianca, limiarEnv(env, "LLM_LIMIAR_CONFIANCA"), LIMIAR_CONFIANCA_PADRAO),
    limiarSemTag: escolher(cfg.limiarSemTag, limiarEnv(env, "LLM_LIMIAR_SEM_TAG"), LIMIAR_SEM_TAG_PADRAO_TECNICO),
    limiarClassificador: escolher(cfg.limiarClassificador, limiarEnv(env, "LLM_LIMIAR_CLASSIFICADOR"), LIMIAR_CLASSIFICADOR_PADRAO_TECNICO),
    timeoutEnvioMs: escolher(
      cfg.timeoutEnvioMs,
      Number.isInteger(timeoutEnv) && timeoutEnv >= TIMEOUT_ENVIO_MIN_MS && timeoutEnv <= TIMEOUT_ENVIO_MAX_MS ? timeoutEnv : undefined,
      TIMEOUT_ENVIO_PADRAO_MS,
    ),
  };
}

const deOnde = (o: Origem) => (o === "env" ? " (vindo do ambiente)" : o === "padrao" ? " (padrão do provedor)" : "");

/** Regras entre campos. `null` = ok; senão a frase para o Admin. */
export function validarCombinacao(e: ConfigTecnicaEfetiva, nodeEnv = process.env.NODE_ENV): string | null {
  const p = e.provedor.valor;
  if (!(PROVEDORES as readonly string[]).includes(p)) return `LLM_PROVEDOR=${p} no ambiente é inválido: escolha o provedor aqui (openai, anthropic ou mock).`;
  if (p === "mock" && nodeEnv === "production") return "O provedor mock não é permitido em produção (criaria cards com dados de teste).";
  const me = e.modeloExtracao.valor;
  if (me && !modeloCombina(me, p))
    return `O modelo de extração "${me}"${deOnde(e.modeloExtracao.origem)} não é do provedor ${p}. Modelos da Anthropic começam com "claude-"; informe um modelo do provedor escolhido.`;
  const mc = e.modeloClassificacao.valor;
  if (mc && e.modeloClassificacao.origem === "config" && !modeloCombina(mc, p))
    return `O modelo de classificação "${mc}" não é do provedor ${p}. Deixe vazio para usar o mesmo da extração.`;
  if (e.limiarSemTag.valor < e.limiarConfianca.valor)
    return `O limiar sem #crm (${e.limiarSemTag.valor}) precisa ser maior ou igual ao limiar com #crm (${e.limiarConfianca.valor}): mensagem sem tag nunca pode ser mais permissiva.`;
  return null;
}

// ------------------------------------------------------------- cache em memória

const g = globalThis as unknown as { __ijConfigTecnica?: { carregada: boolean; promessa?: Promise<void> } };
const estado = () => (g.__ijConfigTecnica ??= { carregada: false });

function aplicar(cfg: ConfigTecnica) {
  definirSobrescritas(paraSobrescritas(cfg));
  const e = estado();
  e.carregada = true;
  e.promessa = undefined;
}

/**
 * Garante a config técnica em memória (lê o banco só na 1ª vez). Nunca lança:
 * banco fora → log com ref e vale o env; tenta de novo na próxima chamada.
 */
export async function carregarConfigTecnica(): Promise<void> {
  const e = estado();
  if (e.carregada) return;
  e.promessa ??= (async () => {
    try {
      const c = await obterConfiguracao(CONFIG_TECNICA);
      aplicar(c.valor);
    } catch (err) {
      registrarErro("config.tecnica.carregar", err);
    } finally {
      e.promessa = undefined;
    }
  })();
  return e.promessa;
}

/** Esquece o cache: a próxima `carregarConfigTecnica` relê o banco (testes, conflito). */
export function invalidarConfigTecnica(): void {
  g.__ijConfigTecnica = { carregada: false };
}

// ------------------------------------------------------------- gravação (ADMIN)

type Ator = { id: string; papel: Papel };

export type ResultadoConfigTecnica =
  | { ok: true; valor: ConfigTecnica }
  | { ok: false; erro: "SEM_PERMISSAO" }
  | { ok: false; erro: "CONFLITO" }
  | { ok: false; erro: "DADOS_INVALIDOS"; mensagem: string };

/** Valida campo a campo, depois a combinação efetiva (com o env), grava e aplica na hora. */
export async function salvarConfigTecnica(entrada: unknown, ator: Ator, versao: Date | null): Promise<ResultadoConfigTecnica> {
  if (!temPapelMinimo(ator.papel, "ADMIN")) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = schemaTecnica.safeParse(entrada);
  if (!r.success) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: r.error.issues[0]?.message ?? "Dados inválidos." };
  const problema = validarCombinacao(resolverConfigTecnica(r.data));
  if (problema) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: problema };
  const s = await salvarConfiguracao(CONFIG_TECNICA, r.data, ator.id, versao);
  if (!s.ok) {
    if (s.erro === "CONFLITO") {
      invalidarConfigTecnica();
      return { ok: false, erro: "CONFLITO" };
    }
    return { ok: false, erro: "DADOS_INVALIDOS", mensagem: s.mensagem };
  }
  aplicar(s.valor);
  return { ok: true, valor: s.valor };
}

/** Apaga a linha: tudo volta a vir do env. Recusa se o env sozinho for uma combinação inválida. */
export async function restaurarConfigTecnica(ator: Ator): Promise<ResultadoConfigTecnica> {
  if (!temPapelMinimo(ator.papel, "ADMIN")) return { ok: false, erro: "SEM_PERMISSAO" };
  const problema = validarCombinacao(resolverConfigTecnica({}));
  if (problema) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: `Sem a configuração daqui o ambiente fica inválido: ${problema}` };
  await restaurarConfiguracao(CONFIG_TECNICA);
  aplicar({});
  return { ok: true, valor: {} };
}
