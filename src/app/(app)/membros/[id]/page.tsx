import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MenuOcupacao } from "@/components/gg/acoes-ocupacao";
import { Chip, Painel, diaBR } from "@/components/gg/ui";
import { temPapelMinimo } from "@/lib/auth/papeis";
import { exigirUsuario } from "@/lib/auth/atual";
import { db } from "@/lib/db";
import { contaDifere, LIMITE_DEMANDA, ROTULO_CATEGORIA, ROTULO_FUNCAO, ROTULO_STATUS_MEMBRO, semestreDe, vigente } from "@/lib/gg/modelo";
import { carregarBase, derivadoDe, ehEditorGG, historicoDe, lideresDe, type BaseOrg } from "@/lib/gg/organizacao";
import { HREF_MEMBROS, veFichaCompleta } from "@/lib/gg/membros";
import { listarAusencias, saldoDemandas } from "@/lib/gg/rotina";
import { diaEmFuso } from "@/lib/projetos/aging";
import { projetosDe } from "@/lib/projetos/equipe";
import { EditarMembro, PeriodoIj, PonteCrm } from "./acoes-ficha";

export const metadata = { title: "Ficha do membro" };
const TOM_STATUS = { ATIVO: "ok", AFASTADO: "aviso", INATIVO: "perigo", NAO_INFORMADO: "neutro" } as const;

/**
 * Ficha do membro (GAB-106: veio de `/gg/membros/[id]`). Todo usuário logado abre; a ficha inteira
 * (e-mail, conta do CRM, períodos, projetos, demandas, faltas, histórico) é de quem edita G&G, da
 * gestão e da própria pessoa (`veFichaCompleta`). Os demais veem nome, área, cargo e status.
 */

// Posição, área ou cargo desativados saem da base (`carregarBase`): a ficha mostra o que der, sem quebrar.
function nomeDaPosicao(base: BaseOrg, pid: string): string {
  return base.posicoes.find((x) => x.id === pid)?.nome ?? "Posição desativada";
}

/** "Área · Cargo · categoria", tolerante a posição/área/cargo fora da base. */
function rotuloDaPosicao(base: BaseOrg, pid: string): string {
  const p = base.posicoes.find((x) => x.id === pid);
  if (!p) return "Posição desativada";
  const c = base.cargos.find((x) => x.id === p.cargoId);
  const area = base.areas.find((a) => a.id === p.areaId)?.nome ?? "Área desativada";
  return c ? `${area} · ${c.nome} · ${ROTULO_CATEGORIA[c.categoria]}` : `${area} · ${p.nome}`;
}

export default async function FichaPage({ params }: { params: Promise<{ id: string }> }) {
  const ator = await exigirUsuario();
  const { id } = await params;
  const base = await carregarBase();
  const editor = await ehEditorGG(ator, base);
  const m = base.membros.find((x) => x.id === id);
  if (!m) notFound();
  const gestao = temPapelMinimo(ator.papel, "GESTOR");
  if (!veFichaCompleta(ator, m, editor)) return <FichaResumida base={base} membroId={id} />;
  const [conta, hist, projetos, saldo, faltas, responsavelDe] = await Promise.all([
    m.usuarioId ? db.usuario.findUnique({ where: { id: m.usuarioId }, select: { papel: true, area: true, cargos: true, ativo: true, senhaHash: true, googleSub: true } }) : null,
    historicoDe(id),
    m.usuarioId ? projetosDe(m.usuarioId) : [],
    saldoDemandas(id),
    m.usuarioId === ator.id || editor || gestao ? listarAusencias(ator).then((as) => as.filter((a) => a.membroId === id)) : null,
    m.usuarioId && m.status === "INATIVO" ? Promise.all([db.projeto.count({ where: { responsavelId: m.usuarioId, deletadoEm: null } }), db.tarefa.count({ where: { responsavelId: m.usuarioId, deletadoEm: null, status: { notIn: ["FEITA", "CANCELADA"] } } })]) : null,
  ]);
  const ocs = base.ocupacoes.filter((o) => o.membroId === id);
  const atuais = ocs.filter((o) => vigente(o, base.hoje));
  const encerradas = ocs.filter((o) => !o.invalidadoEm && !vigente(o, base.hoje));
  const invalidas = ocs.filter((o) => o.invalidadoEm);
  const vincs = base.vinculos.filter((v) => v.membroId === id);
  const d = derivadoDe(base, id);
  const lideres = lideresDe(base, id);
  const nomePos = (pid: string) => nomeDaPosicao(base, pid);
  const rotuloPos = (pid: string) => rotuloDaPosicao(base, pid);
  const semestre = semestreDe(base.hoje);

  return (
    <div className="space-y-5">
      <Link href={HREF_MEMBROS} className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Membros
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">membros · ficha</p>
          <h1 className="text-2xl font-semibold tracking-tight">{m.nome}</h1>
          <p className="font-mono text-xs text-fg-faint">{m.email ?? "sem e-mail"}</p>
        </div>
        <Chip tom={TOM_STATUS[m.status]}>{ROTULO_STATUS_MEMBRO[m.status]}</Chip>
        {editor ? <EditarMembro membro={m} /> : null}
      </header>
      {lideres.length ? <p className="text-sm text-fg-mute">Liderança: {lideres.map((l) => l.nome).join(", ")}</p> : null}

      <PonteCrm
        membroId={id}
        temEmail={!!m.email}
        conta={conta ? { papel: conta.papel, area: conta.area, cargos: conta.cargos, ativo: conta.ativo, conviteAberto: !conta.senhaHash && !conta.googleSub } : null}
        derivado={d}
        difere={conta ? contaDifere(conta, d) : false}
        podeMudarConta={gestao}
        desligado={m.status === "INATIVO" ? { cards: responsavelDe?.[0] ?? 0, tarefas: responsavelDe?.[1] ?? 0 } : null}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Painel titulo="Posições atuais" contagem={atuais.length}>
          <ul className="divide-y divide-border/60">
            {atuais.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  {nomePos(o.posicaoId)} {o.principal ? <Chip tom="gg">principal</Chip> : null}
                  <span className="block text-xs text-fg-faint">{rotuloPos(o.posicaoId)}</span>
                </span>
                <span className="font-mono text-xs text-fg-soft">
                  {o.inicio ? diaBR(o.inicio) : "início ?"} → hoje
                </span>
                {editor ? <MenuOcupacao posicao={{ id: o.posicaoId, nome: nomePos(o.posicaoId) }} ocupantes={[{ ocupacaoId: o.id, nome: m.nome, principal: o.principal }]} posicoes={base.posicoes.map((p) => ({ id: p.id, nome: p.nome }))} hoje={base.hoje} /> : null}
              </li>
            ))}
            {!atuais.length ? (
              <li className="px-4 py-3 text-sm text-fg-faint">
                Sem posição atual. {editor ? <Link href={`${HREF_MEMBROS}?visao=organograma`} className="underline">Atribuir no organograma</Link> : null}
              </li>
            ) : null}
          </ul>
        </Painel>

        <Painel titulo="Projetos (equipe)" contagem={projetos.length}>
          <ul className="divide-y divide-border/60 text-sm">
            {projetos.map((p) => (
              <li key={`${p.projetoId}-${p.inicio}`} className="flex items-center gap-3 px-4 py-2.5">
                <Link href={`/projetos/${p.projetoId}/equipe`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.titulo}
                </Link>
                <Chip tom={p.aberto ? "azul" : "neutro"}>{ROTULO_FUNCAO[p.funcao]}</Chip>
                <span className="font-mono text-xs text-fg-faint">
                  {diaBR(p.inicio)} → {p.fim ? diaBR(p.fim) : "hoje"}
                </span>
              </li>
            ))}
            {!projetos.length ? <li className="px-4 py-3 text-fg-faint">{m.usuarioId ? "Ainda não está na equipe de nenhum projeto." : "Sem conta no CRM: não entra em equipes."}</li> : null}
          </ul>
        </Painel>

        {encerradas.length || invalidas.length ? (
          <Painel titulo="Trajetória">
            <ul className="divide-y divide-border/60 text-sm">
              {encerradas.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    {nomePos(o.posicaoId)}
                    <span className="block text-xs text-fg-faint">{rotuloPos(o.posicaoId)}</span>
                  </span>
                  <span className="font-mono text-xs text-fg-mute">
                    {o.inicio ? diaBR(o.inicio) : "?"} → {diaBR(o.fim)}
                  </span>
                </li>
              ))}
              {invalidas.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                  <span className="min-w-0 flex-1">
                    <span className="line-through">{nomePos(o.posicaoId)}</span> <Chip>retirada por erro</Chip>
                    <span className="block text-xs text-fg-faint">{o.motivoInvalidacao}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Painel>
        ) : null}

        <Painel titulo="Períodos na IJ" acoes={editor ? <PeriodoIj membroId={id} aberto={vincs.some((v) => !v.saida)} hoje={base.hoje} /> : null}>
          <ul className="divide-y divide-border/60 text-sm">
            {vincs.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1">{v.saida ? "Período encerrado" : "Na IJ"}</span>
                <span className="font-mono text-xs text-fg-soft">
                  {v.entrada ? diaBR(v.entrada) : "entrada não informada"} → {v.saida ? diaBR(v.saida) : "hoje"}
                </span>
              </li>
            ))}
            {!vincs.length ? <li className="px-4 py-3 text-fg-faint">Nenhum período registrado.</li> : null}
          </ul>
          {m.status === "INATIVO" && atuais.length ? <p className="border-t border-border px-4 py-2.5 text-xs text-warn">Desligado com posição aberta: encerre as posições no menu ⋯ (o status não fecha nada sozinho).</p> : null}
        </Painel>

        <Painel titulo={`Demandas em ${semestre}`}>
          <div className="flex flex-wrap gap-6 px-4 py-3 text-sm">
            {(["ROSA", "AZUL"] as const).map((t) => (
              <span key={t} className="flex items-center gap-2">
                {t === "ROSA" ? "Rosas" : "Azuis"}
                <span className="flex gap-1" aria-label={`${saldo[t]} de ${LIMITE_DEMANDA[t]}`}>
                  {Array.from({ length: LIMITE_DEMANDA[t] }, (_, i) => (
                    <i key={i} className={`size-3 rounded-[3px] border ${i < saldo[t] ? (t === "ROSA" ? "border-pink-400 bg-pink-400" : "border-chart-4 bg-chart-4") : "border-border-strong"}`} />
                  ))}
                </span>
                <span className="font-mono text-xs text-fg-faint">
                  {saldo[t]}/{LIMITE_DEMANDA[t]}
                </span>
              </span>
            ))}
            <Link href="/gg/demandas" className="ml-auto text-xs text-fg-mute underline">
              ver demandas
            </Link>
          </div>
        </Painel>

        {faltas ? (
          <Painel titulo="Faltas registradas" contagem={faltas.length}>
            <ul className="divide-y divide-border/60 text-sm">
              {faltas.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1">{a.evento}</span>
                  <Chip tom={a.justificada ? "ok" : "aviso"}>{a.justificada ? "justificada" : "não justificada"}</Chip>
                  <span className="font-mono text-xs text-fg-faint">{diaBR(a.data)}</span>
                </li>
              ))}
              {!faltas.length ? <li className="px-4 py-3 text-fg-faint">Nenhuma falta registrada.</li> : null}
            </ul>
          </Painel>
        ) : null}
      </div>

      <Painel titulo="Histórico" contagem={hist.length}>
        <ul className="divide-y divide-border/60 text-sm">
          {hist.map((h) => (
            <li key={h.id} className="grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2">
              <span className="font-mono text-xs text-fg-faint">{diaBR(diaEmFuso(new Date(h.em)))}</span>
              <span>
                {h.evento} {h.autor ? <span className="text-fg-faint">· {h.autor}</span> : null}
              </span>
            </li>
          ))}
          {!hist.length ? <li className="px-4 py-3 text-fg-faint">Sem eventos.</li> : null}
        </ul>
      </Painel>
    </div>
  );
}

/** Ficha para quem não edita G&G nem é da gestão: nome, posições (área e cargo), liderança e status. */
function FichaResumida({ base, membroId }: { base: Awaited<ReturnType<typeof carregarBase>>; membroId: string }) {
  const m = base.membros.find((x) => x.id === membroId)!;
  const atuais = base.ocupacoes.filter((o) => o.membroId === membroId && vigente(o, base.hoje));
  const lideres = lideresDe(base, membroId);
  return (
    <div className="space-y-5">
      <Link href={HREF_MEMBROS} className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Membros
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar nome={m.nome} usuarioId={m.usuarioId ?? m.id} fotoEm={null} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">membros · ficha</p>
          <h1 className="text-2xl font-semibold tracking-tight">{m.nome}</h1>
        </div>
        <Chip tom={TOM_STATUS[m.status]}>{ROTULO_STATUS_MEMBRO[m.status]}</Chip>
      </header>
      {lideres.length ? <p className="text-sm text-fg-mute">Liderança: {lideres.map((l) => l.nome).join(", ")}</p> : null}
      <Painel titulo="Posições atuais" contagem={atuais.length}>
        <ul className="divide-y divide-border/60">
          {atuais.map((o) => {
            return (
              <li key={o.id} className="px-4 py-3 text-sm">
                {nomeDaPosicao(base, o.posicaoId)} {o.principal ? <Chip tom="gg">principal</Chip> : null}
                <span className="block text-xs text-fg-faint">{rotuloDaPosicao(base, o.posicaoId)}</span>
              </li>
            );
          })}
          {!atuais.length ? <li className="px-4 py-3 text-sm text-fg-faint">Sem posição atual.</li> : null}
        </ul>
      </Painel>
      <p className="text-xs text-fg-faint">Contato, histórico e vínculos ficam com Gente &amp; Gestão e a gestão.</p>
    </div>
  );
}
