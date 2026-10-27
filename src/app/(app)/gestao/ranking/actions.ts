"use server";

import { revalidatePath } from "next/cache";
import { exigirPapel } from "@/lib/auth/atual";
import { comTratamentoForm } from "@/lib/erros/registrar";
import { salvarConfigRanking } from "@/lib/ranking/servico";

export type EstadoConfigRanking = { erro?: string; ok?: true } | undefined;

/** Campo numérico do form → número (vazio/lixo vira NaN e o zod recusa com mensagem do campo). */
function numero(form: FormData, nome: string): number {
  const bruto = String(form.get(nome) ?? "").trim();
  return bruto === "" ? Number.NaN : Number(bruto);
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
        cardCriado: numero(form, "cardCriado"),
      },
      minimos: { fechadosConversao: numero(form, "fechadosConversao"), ganhosTempo: numero(form, "ganhosTempo") },
      mostrarAosVendedores: form.get("mostrarAosVendedores") === "on",
    };
    const r = await salvarConfigRanking(entrada, ator);
    if (!r.ok) return { erro: r.erro === "SEM_PERMISSAO" ? "Só gestor ou admin altera o ranking." : r.mensagem };
    revalidatePath("/gestao/ranking");
    revalidatePath("/ranking");
    revalidatePath("/semana");
    return { ok: true };
  });
}
