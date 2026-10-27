import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { obterConfiguracao } from "@/lib/configuracao/servico";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { CONFIG_RANKING } from "@/lib/ranking/config";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { nomesDeUsuarios } from "@/lib/oportunidades/oportunidades";
import { ConfigRankingForm } from "./config-form";

export const metadata = { title: "Ranking · Gestão" };

/** Gestão → Ranking (GAB-44): pesos, mínimos e visibilidade para vendedores. */
export default async function GestaoRankingPage() {
  await exigirPapel("GESTOR");
  const dados = await comTratamento("pagina.gestao.ranking", async () => {
    const c = await obterConfiguracao(CONFIG_RANKING);
    const autor = c.atualizadoPor ? (await nomesDeUsuarios([c.atualizadoPor])).get(c.atualizadoPor) ?? null : null;
    return { c, autor };
  });
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const { c, autor } = dados;
  return (
    <>
      <PageHeader eyebrow="gestão · ranking" title="Ranking" description="Pesos da pontuação, mínimos dos destaques e quem vê o ranking. Tudo é recalculado na leitura: mudar um peso vale para todos os períodos." />
      <div className="max-w-3xl space-y-4">
        {c.invalido ? (
          <p role="alert" className="font-mono text-xs text-warn">
            valor salvo inválido — usando o padrão. Salve para corrigir.
          </p>
        ) : c.atualizadoEm ? (
          <p className="font-mono text-xs text-fg-mute">
            alterado em {formatarDataHora(c.atualizadoEm)}
            {autor ? ` por ${autor}` : ""}
          </p>
        ) : (
          <p className="font-mono text-xs text-fg-mute">usando os valores padrão</p>
        )}
        <ConfigRankingForm atual={c.valor} versao={c.atualizadoEm?.getTime() ?? null} />
      </div>
    </>
  );
}
