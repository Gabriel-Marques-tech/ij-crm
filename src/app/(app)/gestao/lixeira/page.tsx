import Link from "next/link";
import { cn } from "cn";
import { Trash2 } from "lucide-react";
import { FormBusca } from "@/components/entidades/form-busca";
import { AcaoConfirmada } from "@/components/lixeira/acao-confirmada";
import { Restaurar } from "@/components/lixeira/restaurar";
import { PageHeader } from "@/components/shell/page-header";
import { exigirPapel } from "@/lib/auth/atual";
import { listarCardsNaLixeira, listarContatosNaLixeira, listarEmpresasNaLixeira } from "@/lib/lixeira/lixeira";
import { podeApagarDeVez } from "@/lib/lixeira/regras";
import { formatarCnpj } from "@/lib/normalizacao";
import { formatarDataHora } from "@/lib/oportunidades/formatar";
import { apagarCardAction, apagarEntidadeAction, restaurarCardAction, restaurarEntidadeAction } from "../../_lixeira/actions";

export const metadata = { title: "Lixeira" };

const ABAS = [
  { chave: "cards", rotulo: "Cards" },
  { chave: "contatos", rotulo: "Contatos" },
  { chave: "empresas", rotulo: "Empresas" },
] as const;
type Aba = (typeof ABAS)[number]["chave"];

function Linha({ children, acoes }: { children: React.ReactNode; acoes: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex flex-wrap items-start gap-2">{acoes}</div>
    </li>
  );
}

function Quando({ em, por }: { em: Date; por?: string | null }) {
  return (
    <p className="mt-0.5 text-xs text-fg-mute">
      excluído <span className="font-mono tabular">{formatarDataHora(em)}</span>
      {por ? <> por {por}</> : null}
    </p>
  );
}

const AVISO_APAGAR = "Apaga de verdade, sem volta. Telefones, emails e CNPJ ficam livres para reuso.";

export default async function LixeiraPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string }> }) {
  const ator = await exigirPapel("GESTOR");
  const sp = await searchParams;
  const aba: Aba = ABAS.some((a) => a.chave === sp.aba) ? (sp.aba as Aba) : "cards";
  const q = typeof sp.q === "string" ? sp.q : "";
  const admin = podeApagarDeVez(ator.papel);

  let conteudo: React.ReactNode;
  if (aba === "cards") {
    const cards = await listarCardsNaLixeira(q);
    conteudo = cards.map((c) => (
      <Linha
        key={c.id}
        acoes={
          <>
            <Restaurar acao={restaurarCardAction.bind(null, c.id)} opcoesFase={c.opcoesFase} />
            {admin ? (
              <AcaoConfirmada
                rotulo="Apagar de vez"
                variante="destructive"
                titulo="Apagar o card definitivamente?"
                descricao="O card, a Timeline e o histórico de fases somem para sempre. O card ligado (venda ↔ projeto) perde o vínculo e ganha uma nota."
                digitar={c.titulo}
                confirmar="Apagar de vez"
                rotuloAcao="apagar o card"
                acao={apagarCardAction.bind(null, c.id)}
              />
            ) : null}
          </>
        }
      >
        <p className="truncate text-sm font-medium text-foreground">{c.titulo}</p>
        <p className="mt-0.5 text-xs text-fg-soft">
          {c.pipeline.nome} · {c.fase.nome}
          {c.fase.arquivada ? <span className="text-warn"> (fase arquivada — escolha outra para restaurar)</span> : null}
          {c.empresa ? <> · {c.empresa}</> : null}
        </p>
        <Quando em={c.deletadoEm} por={c.porNome} />
      </Linha>
    ));
  } else if (aba === "contatos") {
    const contatos = await listarContatosNaLixeira(q);
    conteudo = contatos.map((c) => (
      <Linha
        key={c.id}
        acoes={
          <>
            <Restaurar acao={restaurarEntidadeAction.bind(null, "contato", c.id)} />
            {admin ? (
              <AcaoConfirmada
                rotulo="Apagar de vez"
                variante="destructive"
                titulo="Apagar o contato definitivamente?"
                descricao={`${AVISO_APAGAR} Cards ligados ficam sem contato (com nota na Timeline).`}
                digitar={c.nome}
                confirmar="Apagar de vez"
                rotuloAcao="apagar o contato"
                acao={apagarEntidadeAction.bind(null, "contato", c.id)}
              />
            ) : null}
          </>
        }
      >
        <p className="truncate text-sm font-medium text-foreground">{c.nome}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-fg-mute">
          {c.pontos.map((p) => (
            <span key={p.id}>{p.valorNormalizado}</span>
          ))}
        </p>
        <p className="mt-0.5 text-xs text-fg-soft">
          {c.empresa ? <>{c.empresa.nome} · </> : null}
          <span className="font-mono tabular">{c._count.oportunidades}</span> oportunidade(s)
          {c._count.mergedFrom > 0 ? (
            <>
              {" "}
              · <span className="font-mono tabular">{c._count.mergedFrom}</span> mesclado(s) nele
            </>
          ) : null}
        </p>
        {c.deletadoEm ? <Quando em={c.deletadoEm} /> : null}
      </Linha>
    ));
  } else {
    const empresas = await listarEmpresasNaLixeira(q);
    conteudo = empresas.map((e) => (
      <Linha
        key={e.id}
        acoes={
          <>
            <Restaurar acao={restaurarEntidadeAction.bind(null, "empresa", e.id)} />
            {admin ? (
              <AcaoConfirmada
                rotulo="Apagar de vez"
                variante="destructive"
                titulo="Apagar a empresa definitivamente?"
                descricao={`${AVISO_APAGAR} Cards e contatos ligados ficam sem empresa (cards com nota na Timeline).`}
                digitar={e.nome}
                confirmar="Apagar de vez"
                rotuloAcao="apagar a empresa"
                acao={apagarEntidadeAction.bind(null, "empresa", e.id)}
              />
            ) : null}
          </>
        }
      >
        <p className="truncate text-sm font-medium text-foreground">{e.nome}</p>
        <p className="mt-0.5 text-xs text-fg-soft">
          {e.cnpj ? <span className="font-mono">{formatarCnpj(e.cnpj)} · </span> : null}
          <span className="font-mono tabular">{e._count.contatos}</span> contato(s) · <span className="font-mono tabular">{e._count.oportunidades}</span> oportunidade(s)
          {e._count.mergedFrom > 0 ? (
            <>
              {" "}
              · <span className="font-mono tabular">{e._count.mergedFrom}</span> mesclada(s) nela
            </>
          ) : null}
        </p>
        {e.deletadoEm ? <Quando em={e.deletadoEm} /> : null}
      </Linha>
    ));
  }
  const vazio = Array.isArray(conteudo) && conteudo.length === 0;

  return (
    <>
      <PageHeader eyebrow="gestão" title="Lixeira" description="Cards, contatos e empresas excluídos. Restaurar devolve tudo como estava." />
      <nav aria-label="Tipo" className="mb-4 flex gap-1 border-b border-border">
        {ABAS.map((a) => (
          <Link
            key={a.chave}
            href={`/gestao/lixeira?aba=${a.chave}`}
            aria-current={a.chave === aba ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", a.chave === aba ? "border-primary text-foreground" : "border-transparent text-fg-mute hover:text-foreground")}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>
      <FormBusca key={aba} ocultos={{ aba }} valor={q} rotulo="Buscar na lixeira" placeholder={aba === "cards" ? "título do card" : aba === "contatos" ? "nome, telefone ou email" : "nome ou CNPJ"} />
      {vazio ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-surface p-5 text-sm text-fg-faint">
          <Trash2 className="size-4" aria-hidden /> {q ? "Nada encontrado na lixeira." : "Lixeira vazia."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-4">{conteudo}</ul>
      )}
    </>
  );
}
