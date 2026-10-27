"use server";

import { revalidatePath } from "next/cache";
import { exigirPapel } from "@/lib/auth/atual";
import { ConfigAusente, ConfigFraca } from "@/lib/config/env";
import { restaurarConfigTecnica, salvarConfigTecnica, type ConfigTecnica, type ResultadoConfigTecnica } from "@/lib/config/tecnica";
import { MENSAGEM_CONFLITO_CONFIGURACAO } from "@/lib/configuracao/servico";
import { comTratamento, comTratamentoForm } from "@/lib/erros/registrar";
import { ErroEvolutionAdmin, listarGrupos, obterQr, type GrupoEvolution } from "@/lib/whatsapp/evolution-admin";

export type EstadoConfigTecnica = { erro?: string; ok?: true } | undefined;

const texto = (form: FormData, nome: string) => String(form.get(nome) ?? "").trim();

/** Vazio = não define (herda do env); senão número (vírgula aceita; lixo vira NaN e o zod recusa). */
function numero(form: FormData, nome: string): number | undefined {
  const b = texto(form, nome);
  return b === "" ? undefined : Number(b.replace(",", "."));
}

function versaoCarregada(form: FormData): Date | null {
  const b = texto(form, "versao");
  const ms = Number(b);
  return b === "" || !Number.isFinite(ms) ? null : new Date(ms);
}

function entradaDe(form: FormData): ConfigTecnica {
  const segundos = numero(form, "timeoutEnvioS");
  const bruto: Record<string, unknown> = {
    grupoJid: texto(form, "grupoJid") || undefined,
    provedor: texto(form, "provedor") || undefined,
    modeloExtracao: texto(form, "modeloExtracao") || undefined,
    modeloClassificacao: texto(form, "modeloClassificacao") || undefined,
    limiarConfianca: numero(form, "limiarConfianca"),
    limiarSemTag: numero(form, "limiarSemTag"),
    limiarClassificador: numero(form, "limiarClassificador"),
    timeoutEnvioMs: segundos === undefined ? undefined : Math.round(segundos * 1000),
  };
  return Object.fromEntries(Object.entries(bruto).filter(([, v]) => v !== undefined)) as ConfigTecnica;
}

function estadoDe(r: ResultadoConfigTecnica): EstadoConfigTecnica {
  if (r.ok) {
    revalidatePath("/gestao/admin");
    return { ok: true };
  }
  if (r.erro === "SEM_PERMISSAO") return { erro: "Só admin altera a configuração técnica." };
  if (r.erro === "CONFLITO") return { erro: MENSAGEM_CONFLITO_CONFIGURACAO };
  return { erro: r.mensagem };
}

/** Admin → Configuração: salva (campos vazios herdam do env). Vale na próxima mensagem. */
export async function salvarConfigTecnicaAction(_prev: EstadoConfigTecnica, form: FormData): Promise<EstadoConfigTecnica> {
  const ator = await exigirPapel("ADMIN");
  return comTratamentoForm("admin.config.salvar", async () => estadoDe(await salvarConfigTecnica(entradaDe(form), ator, versaoCarregada(form))));
}

/** Apaga a config salva: tudo volta a vir do env. */
export async function restaurarConfigTecnicaAction(): Promise<EstadoConfigTecnica> {
  const ator = await exigirPapel("ADMIN");
  return comTratamentoForm("admin.config.restaurar", async () => estadoDe(await restaurarConfigTecnica(ator)));
}

/** Erro esperado da Evolution (fora, timeout, env faltando) → frase; o resto → ref. */
function erroEvolution(e: unknown): string | null {
  if (e instanceof ErroEvolutionAdmin) return e.message;
  if (e instanceof ConfigAusente) return `Evolution não configurada: ${e.variavel} ausente no ambiente.`;
  if (e instanceof ConfigFraca) return `Evolution não configurada: ${e.variavel} fraca (${e.motivo}).`;
  return null;
}

type ResultadoEvolution<T> = ({ ok: true } & T) | { ok: false; erro: string; ref?: string };

async function viaEvolution<T>(contexto: string, corpo: () => Promise<T>): Promise<ResultadoEvolution<T>> {
  const r = await comTratamento(contexto, async (): Promise<ResultadoEvolution<T>> => {
    try {
      return { ok: true, ...(await corpo()) };
    } catch (e) {
      const msg = erroEvolution(e);
      if (msg === null) throw e;
      return { ok: false, erro: msg };
    }
  });
  if ("erro" in r && r.erro === "INESPERADO") return { ok: false, erro: `Erro no servidor (ref: ${r.ref}).`, ref: r.ref };
  return r as ResultadoEvolution<T>;
}

export async function listarGruposAction(): Promise<ResultadoEvolution<{ grupos: GrupoEvolution[] }>> {
  await exigirPapel("ADMIN");
  return viaEvolution("admin.evolution.grupos", async () => ({ grupos: await listarGrupos() }));
}

/** QR que vincula o WhatsApp: só ADMIN, nunca logado (só a classe do erro, sem corpo), sem cache. */
export async function mostrarQrAction(): Promise<ResultadoEvolution<{ qr: string | null }>> {
  await exigirPapel("ADMIN");
  return viaEvolution("admin.evolution.qr", async () => ({ qr: (await obterQr())?.base64 ?? null }));
}
