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
import { ErroEvolutionAdmin, listarGrupos } from "@/lib/whatsapp/evolution-admin";
import { ConfigAusente, ConfigFraca, LIMIAR_CLASSIFICADOR_PADRAO, LIMIAR_CONFIANCA_PADRAO, LIMIAR_SEM_TAG_PADRAO, MODELOS_EXTRACAO_PADRAO, TIMEOUT_ENVIO_MAX_MS, TIMEOUT_ENVIO_MIN_MS, TIMEOUT_ENVIO_PADRAO_MS, modeloDoProvedor } from "./env";
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


const PROVEDORES = ["openai", "anthropic", "gemini", "mock"] as const;
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
  provedor: z.enum(PROVEDORES, { error: "Provedor: openai, anthropic, gemini ou mock." }),
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

// `Object.hasOwn`: `in` aceitaria "constructor"/"toString" vindos do env.
const ehReal = (p: string): p is keyof typeof MODELOS_EXTRACAO_PADRAO => Object.hasOwn(MODELOS_EXTRACAO_PADRAO, p);
/** Mesma regra de `env.ts` (prefixo); mock/inválido não restringe o modelo. */
const modeloCombina = (m: string, p: string) => (ehReal(p) ? modeloDoProvedor(m, p) : true);

/**
 * O que está valendo, campo a campo, e de onde veio. Espelha as leituras de
 * `env.ts` (mesmo parse; env ilegível = padrão). Pura: `env` injetável.
 */
export function resolverConfigTecnica(cfg: ConfigTecnica, env: Env = process.env): ConfigTecnicaEfetiva {
  const provedor = escolher<string>(cfg.provedor, lerEnv(env, "LLM_PROVEDOR")?.toLowerCase(), "openai");
  const p = provedor.valor;
  const padraoModelo = ehReal(p) ? MODELOS_EXTRACAO_PADRAO[p] : null;
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
    limiarSemTag: escolher(cfg.limiarSemTag, limiarEnv(env, "LLM_LIMIAR_SEM_TAG"), LIMIAR_SEM_TAG_PADRAO),
    limiarClassificador: escolher(cfg.limiarClassificador, limiarEnv(env, "LLM_LIMIAR_CLASSIFICADOR"), LIMIAR_CLASSIFICADOR_PADRAO),
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
  if (!(PROVEDORES as readonly string[]).includes(p)) return `LLM_PROVEDOR=${p} no ambiente é inválido: escolha o provedor aqui (openai, anthropic, gemini ou mock).`;
  if (p === "mock" && nodeEnv === "production") return "O provedor mock não é permitido em produção (criaria cards com dados de teste).";
  const me = e.modeloExtracao.valor;
  if (me && !modeloCombina(me, p))
    return `O modelo de extração "${me}"${deOnde(e.modeloExtracao.origem)} não é do provedor ${p}. Modelos da Anthropic começam com "claude-" e os do Gemini com "gemini-"; informe um modelo do provedor escolhido.`;
  const mc = e.modeloClassificacao.valor;
  if (mc && e.modeloClassificacao.origem === "config" && !modeloCombina(mc, p))
    return `O modelo de classificação "${mc}" não é do provedor ${p}. Deixe vazio para usar o mesmo da extração.`;
  if (e.limiarSemTag.valor < e.limiarConfianca.valor)
    return `O limiar sem #crm (${e.limiarSemTag.valor}) precisa ser maior ou igual ao limiar com #crm (${e.limiarConfianca.valor}): mensagem sem tag nunca pode ser mais permissiva.`;
  return null;
}

/** Sem grupo efetivo o webhook responde 503 para tudo: o CRM fica surdo. */
function semGrupo(e: ConfigTecnicaEfetiva): string | null {
  return e.grupoJid.valor
    ? null
    : "Assim o CRM fica sem grupo: o webhook recusaria todas as mensagens. Informe o GRUPO_JID aqui (ou no ambiente) antes.";
}

// ------------------------------------------------------------- cache em memória

/**
 * `geracao` sobe a cada salvar, restaurar ou invalidar. Uma carga só aplica o
 * que leu se a geração não mudou durante a leitura; se mudou por invalidação,
 * relê; se mudou porque alguém aplicou um valor novo, esse vale.
 */
type EstadoCache = { carregada: boolean; geracao: number; promessa?: Promise<ResultadoCarga> };
const g = globalThis as unknown as { __ijConfigTecnica?: EstadoCache };
const estado = () => (g.__ijConfigTecnica ??= { carregada: false, geracao: 0 });

export type ResultadoCarga = { ok: true } | { ok: false; ref: string };

function aplicar(cfg: ConfigTecnica) {
  definirSobrescritas(paraSobrescritas(cfg));
  const e = estado();
  e.geracao++;
  e.carregada = true;
}

/** Lê a linha e aplica, ignorando (com log só da chave) combinação que ficou inválida. */
async function ler(e: EstadoCache): Promise<ResultadoCarga> {
  for (;;) {
    const geracao = e.geracao;
    const c = await obterConfiguracao(CONFIG_TECNICA);
    if (e.geracao !== geracao) {
      if (e.carregada) return { ok: true }; // salvar/restaurar aplicou um valor mais novo
      continue; // invalidado durante a leitura: relê
    }
    if (c.atualizadoEm === null) {
      // Nada salvo: vale só o ambiente. GRUPO_JID vazio (normal em dev) não é erro de
      // config — o webhook já acusa (503) —, mas combinação inválida do env é avisada.
      const problema = validarCombinacao(resolverConfigTecnica({}));
      if (problema) registrarErro("config.tecnica.carregar", new Error(`ambiente com combinação inválida (nada salvo no Admin): ${problema}`));
      aplicar({});
    } else if (validarCombinacao(resolverConfigTecnica(c.valor)) !== null || semGrupo(resolverConfigTecnica(c.valor)) !== null) {
      // Só a chave: o valor pode ter modelo/JID. A tela do Admin mostra o motivo.
      registrarErro("config.tecnica.carregar", new Error(`configuração salva "${CONFIG_TECNICA.chave}" forma combinação inválida com o ambiente; usando só o ambiente`));
      aplicar({});
    } else {
      aplicar(c.valor);
    }
    return { ok: true };
  }
}

/**
 * Garante a config técnica em memória (lê o banco só na 1ª vez). Nunca lança:
 * banco fora → log com ref e `{ ok: false, ref }` — quem chama falha fechado
 * (webhook 503, processamento deixa a mensagem RECEBIDA); tenta de novo depois.
 */
export async function carregarConfigTecnica(): Promise<ResultadoCarga> {
  const e = estado();
  if (e.carregada) return { ok: true };
  if (!e.promessa) {
    const p: Promise<ResultadoCarga> = ler(e)
      .catch((err) => ({ ok: false as const, ref: registrarErro("config.tecnica.carregar", err) }))
      .finally(() => {
        if (e.promessa === p) e.promessa = undefined;
      });
    e.promessa = p;
  }
  return e.promessa;
}

/** Esquece o cache: a próxima `carregarConfigTecnica` relê o banco (testes, conflito). */
export function invalidarConfigTecnica(): void {
  const e = estado();
  e.geracao++;
  e.carregada = false;
  e.promessa = undefined;
}

// ------------------------------------------------------------- gravação (ADMIN)

type Ator = { id: string; papel: Papel };

export type ResultadoConfigTecnica =
  | { ok: true; valor: ConfigTecnica }
  | { ok: false; erro: "SEM_PERMISSAO" }
  | { ok: false; erro: "CONFLITO" }
  | { ok: false; erro: "DADOS_INVALIDOS"; mensagem: string }
  /** Grupo novo e a Evolution não respondeu: só com `confirmarSemEvolution`. */
  | { ok: false; erro: "EVOLUTION_INDISPONIVEL"; mensagem: string };

export type OpcoesSalvar = {
  /** "Salvar mesmo assim" marcado: aceita grupo novo sem conferir na Evolution. */
  confirmarSemEvolution?: boolean;
  /** Injetável nos testes. */
  listarGrupos?: () => Promise<{ jid: string }[]>;
};

/** Erro esperado de falar com a Evolution (fora, timeout, env faltando). */
function evolutionIndisponivel(e: unknown): string | null {
  if (e instanceof ErroEvolutionAdmin) return e.message;
  if (e instanceof ConfigAusente || e instanceof ConfigFraca) return `Evolution não configurada (${e.variavel}).`;
  return null;
}

/**
 * Valida campo a campo; a combinação efetiva (com o env); que sobra um grupo;
 * e, se o grupo mudou, que a instância está nele. Grava e aplica na hora.
 */
export async function salvarConfigTecnica(entrada: unknown, ator: Ator, versao: Date | null, opts: OpcoesSalvar = {}): Promise<ResultadoConfigTecnica> {
  if (!temPapelMinimo(ator.papel, "ADMIN")) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = schemaTecnica.safeParse(entrada);
  if (!r.success) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: r.error.issues[0]?.message ?? "Dados inválidos." };
  const efetivo = resolverConfigTecnica(r.data);
  const problema = validarCombinacao(efetivo) ?? semGrupo(efetivo);
  if (problema) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: problema };

  const novo = r.data.grupoJid;
  if (novo && novo !== (await obterConfiguracao(CONFIG_TECNICA)).valor.grupoJid) {
    try {
      const grupos = await (opts.listarGrupos ?? listarGrupos)();
      if (!grupos.some((x) => x.jid === novo))
        return { ok: false, erro: "DADOS_INVALIDOS", mensagem: `O grupo ${novo} não está entre os grupos da instância do WhatsApp. Use "Listar grupos" e escolha um deles.` };
    } catch (e) {
      const motivo = evolutionIndisponivel(e);
      if (motivo === null) throw e;
      if (!opts.confirmarSemEvolution)
        return { ok: false, erro: "EVOLUTION_INDISPONIVEL", mensagem: `Não deu para conferir o grupo na Evolution (${motivo}). Confira o JID e marque "salvar mesmo assim".` };
    }
  }

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

/**
 * Apaga a linha (só se ainda for a `versao` carregada): tudo volta a vir do
 * env. Recusa se o env sozinho for inválido ou não tiver grupo.
 */
export async function restaurarConfigTecnica(ator: Ator, versao: Date | null): Promise<ResultadoConfigTecnica> {
  if (!temPapelMinimo(ator.papel, "ADMIN")) return { ok: false, erro: "SEM_PERMISSAO" };
  const soEnv = resolverConfigTecnica({});
  const problema = validarCombinacao(soEnv) ?? semGrupo(soEnv);
  if (problema) return { ok: false, erro: "DADOS_INVALIDOS", mensagem: `Sem a configuração daqui o ambiente fica inválido: ${problema}` };
  if (!(await restaurarConfiguracao(CONFIG_TECNICA, versao))) {
    invalidarConfigTecnica();
    return { ok: false, erro: "CONFLITO" };
  }
  aplicar({});
  return { ok: true, valor: {} };
}
