import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { podeEditarEquipe, podeVerTarefas } from "@/lib/auth/areas";
import { exigirUsuario } from "@/lib/auth/atual";
import { db } from "@/lib/db";
import { candidatosEquipe, cargaPorPessoa, escalaDoProjeto, listarEquipe } from "@/lib/projetos/equipe";
import { diaEmFuso } from "@/lib/projetos/aging";
import { podeVerTarefasNoProjeto, resumoTarefas } from "@/lib/tarefas/tarefas";
import { AbasProjeto } from "../abas-projeto";
import { EquipeProjeto } from "./equipe-projeto";

export const metadata = { title: "Equipe do projeto" };

/** Quem trabalha neste projeto. O time de projetos vê; diretoria, GP e responsável do card montam. */
export default async function EquipePage({ params }: { params: Promise<{ id: string }> }) {
  const ator = await exigirUsuario();
  if (!podeVerTarefas(ator)) redirect("/403");
  const { id } = await params;
  const escala = await escalaDoProjeto(id);
  if (!escala) notFound();
  const [projeto, equipe, candidatos, verTarefas] = await Promise.all([
    db.projeto.findUniqueOrThrow({ where: { id }, select: { id: true, titulo: true, responsavel: { select: { id: true, nome: true } }, handoff: { select: { gpProjeto: { select: { id: true, nome: true } } } } } }),
    listarEquipe(id),
    candidatosEquipe(),
    podeVerTarefasNoProjeto(id, ator),
  ]);
  const carga = await cargaPorPessoa(candidatos.map((c) => c.id));
  const tarefas = verTarefas ? await resumoTarefas(id, ator.id, diaEmFuso(new Date())) : null;
  const naEquipe = new Set(equipe.atuais.map((m) => m.usuarioId));

  return (
    <div className="space-y-5">
      <MarcarQuadroAtivo quadro="projetos" />
      <Link href={`/projetos/${id}`} className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {projeto.titulo}
      </Link>
      <PageHeader eyebrow="projetos · equipe" title={projeto.titulo} />
      <AbasProjeto projetoId={id} ativa="equipe" tarefasAbertas={tarefas?.abertas ?? null} />
      <EquipeProjeto
        projetoId={id}
        podeEditar={podeEditarEquipe(ator, escala)}
        atuais={equipe.atuais}
        antigos={equipe.antigos}
        responsavel={projeto.responsavel}
        gp={projeto.handoff?.gpProjeto ?? null}
        candidatos={candidatos.filter((c) => !naEquipe.has(c.id)).map((c) => ({ ...c, ...carga.get(c.id)! }))}
        cargaDaEquipe={Object.fromEntries(equipe.atuais.map((m) => [m.usuarioId, carga.get(m.usuarioId) ?? { projetos: 0, tarefas: 0 }]))}
      />
    </div>
  );
}
