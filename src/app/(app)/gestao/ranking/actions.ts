"use server";

import { revalidatePath } from "next/cache";
import { exigirPapel } from "@/lib/auth/atual";
import { MENSAGEM_CONFLITO_CONFIGURACAO } from "@/lib/configuracao/servico";
import { comTratamentoForm } from "@/lib/erros/registrar";
import { salvarConfigRanking } from "@/lib/ranking/servico";

export type EstadoConfigRanking = { erro?: string; ok?: true } | undefined;

/** Campo numérico do form → número (vazio/lixo vira NaN e o zod recusa com mensagem do campo). */
function numero(form: FormData, nome: string): number {
  const bruto = String(form.get(nome) ?? "").trim();
  return bruto === "" ? Number.NaN : Number(bruto);
}

/** `atualizado_em` (ms) que o formulário carregou; vazio = não havia configuração salva. */
function versaoCarregada(form: FormData): Date | null {
  const bruto = String(form.get("versao") ?? "");
  const ms = Number(bruto);
  return bruto === "" || !Number.isFinite(ms) ? null : new Date(ms);
}

/** Gestão → Ranking: pesos, mínimos e visibilidade (GESTOR+; o serviço confere de novo). */
export async function salvarConfigRankingAction(_prev: EstadoConfigRanking, form: FormData): Promise<EstadoConfigRanking> {
  return comTratamentoForm("gestao.ranking.salvar", async (): Promise<EstadoConfigRanking> => {
    const ator = await exigirPapel("GESTOR");
    const entrada = {
      pesos: {
        ganho: numero(form, "ganho"),
        bonusPorMil: numero(form, "bonusPorMil"),
        tetoBonus: numero(form, "tetoBonus"),
        avanco: numero(form, "avanco"),
        acaoFeita: numero(form, "acaoFeita"),
        acoesPorDia: numero(form, "acoesPorDia"),
        cardCriado: numero(form, "cardCriado"),
      },
      minimos: { fechadosConversao: numero(form, "fechadosConversao"), ganhosTempo: numero(form, "ganhosTempo") },
      mostrarAosVendedores: form.get("mostrarAosVendedores") === "on",
    };
    const r = await salvarConfigRanking(entrada, ator, versaoCarregada(form));
    if (!r.ok) {
      if (r.erro === "SEM_PERMISSAO") return { erro: "Só gestor ou admin altera o ranking." };
      if (r.erro === "CONFLITO") return { erro: MENSAGEM_CONFLITO_CONFIGURACAO };
      return { erro: r.mensagem };
    }
    revalidatePath("/gestao/ranking");
    revalidatePath("/ranking");
    revalidatePath("/semana");
    return { ok: true };
  });
}
