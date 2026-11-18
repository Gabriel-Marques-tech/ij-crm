import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { opcoesDePosicao } from "@/lib/auth/cadastro";
import { googleConfigurado } from "@/lib/auth/google";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { hrefMembros, lerVisao, podeCadastrarPessoa, type Visao } from "@/lib/gg/membros";
import { carregarBase, ehEditorGG } from "@/lib/gg/organizacao";
import { AcoesMembros } from "./acoes-membros";
import { CadastrarPessoa } from "./cadastrar-pessoa";
import { ListaMembros } from "./lista";
import { Organograma } from "./organograma";

export const metadata = { title: "Membros" };

type Busca = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Membros da IJ inteira (GAB-106), fora de Gente & Gestão: organograma e lista da mesma base, com a
 * visão na URL (`?visao=organograma|lista`). Todo usuário logado lê. Os controles aparecem só para
 * quem o servidor aceitaria: cadastrar pessoa (gestor e admin) e Novo membro/posições/estrutura
 * (editor de G&G e admin). `?cadastrar=<posição>` abre o cadastro já na posição (cargo vago).
 */
export default async function MembrosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const sp = await searchParams;
  const visao = lerVisao(um(sp.visao));
  const base = await carregarBase();
  const editor = await ehEditorGG(ator, base);
  const gestao = temPapelMinimo(ator.papel, "GESTOR");
  const cadastra = podeCadastrarPessoa(ator.papel);
  const posicoes = cadastra ? opcoesDePosicao(base) : null;
  // Só uma posição ativa abre o cadastro; qualquer outro valor é ignorado.
  const cadastrar = cadastra ? (base.posicoes.find((p) => p.id === um(sp.cadastrar))?.id ?? null) : null;
  const params = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "visao" && k !== "cadastrar" ? [[k, v]] : [])));

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        eyebrow="inteli júnior · membros"
        title="Membros"
        description="Toda pessoa da IJ, com ou sem conta no CRM, e o lugar dela no organograma."
        actions={
          editor || cadastra ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {editor ? (
                <Link href="/membros/estrutura" className={buttonVariants({ variant: "outline" })}>
                  <BadgeCheck className="h-4 w-4" />
                  Áreas e cargos
                </Link>
              ) : null}
              {editor ? <AcoesMembros editor gestao={gestao} /> : null}
              {posicoes ? (
                <CadastrarPessoa
                  key={cadastrar ?? ""}
                  papelAtor={ator.papel}
                  googleAtivo={googleConfigurado()}
                  posicoes={posicoes}
                  posicaoInicial={cadastrar}
                  hrefAoFechar={hrefMembros({ visao, ...params })}
                />
              ) : null}
            </div>
          ) : null
        }
      />
      <Alternador visao={visao} params={params} />
      {visao === "lista" ? (
        <ListaMembros ator={ator} base={base} editor={editor} filtros={{ q: um(sp.q), area: um(sp.area), cargo: um(sp.cargo), status: um(sp.status) }} />
      ) : (
        <Organograma base={base} editor={editor} cadastra={cadastra} escopo={um(sp.escopo)} fechado={um(sp.fechado)} />
      )}
    </div>
  );
}

const ROTULO_VISAO: Record<Visao, string> = { organograma: "Organograma", lista: "Lista" };

/** Organograma | Lista. Leva os outros parâmetros junto (filtros da lista, galhos do organograma). */
function Alternador({ visao, params }: { visao: Visao; params: Record<string, string> }) {
  return (
    <nav aria-label="Visão" className="inline-flex rounded-lg border border-border-strong p-0.5 text-sm">
      {(Object.keys(ROTULO_VISAO) as Visao[]).map((v) => (
        <Link
          key={v}
          href={hrefMembros({ visao: v, ...params })}
          aria-current={visao === v ? "page" : undefined}
          className={cn("rounded-md px-3 py-1", visao === v ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}
        >
          {ROTULO_VISAO[v]}
        </Link>
      ))}
    </nav>
  );
}
