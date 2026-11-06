import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EstadoVazio } from "@/components/estado-vazio";
import type { DadosCapa } from "@/components/propostas/folha";
import { buttonVariants } from "@/components/ui/button";
import { StatusPropostaBadge } from "@/components/propostas/status-proposta";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { listarAnexos } from "@/lib/anexos/anexos";
import { exigirUsuario } from "@/lib/auth/atual";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { acoesPossiveis, ladoDaCaneta, outroLado, podeEditarProposta } from "@/lib/propostas/caneta";
import { acoesDeEnvio, versaoDoPdf } from "@/lib/propostas/envio";
import { estruturadoParaEntrada } from "@/lib/propostas/estruturado";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { dataPorExtenso, ENDERECO_IJ } from "@/lib/propostas/pdf";
import { podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { listarComentarios } from "@/lib/propostas/comentarios";
import { PIPELINE_PROJETOS } from "@/lib/projetos/terminal-regras";
import { listarPessoasDaCaneta, obterPropostaDoProjeto, pessoaDaCaneta, tempoComCaneta } from "@/lib/propostas/propostas";
import { podeCriarProposta } from "@/lib/propostas/regras";
import { urlPdfDaProposta, urlPreviaDaProposta } from "@/lib/propostas/url";
import { AcoesCaneta } from "./acoes-caneta";
import { ComentariosAbertos, Marcador } from "./cartao-envio";
import { ComentariosProvider, type ThreadJson } from "./comentarios-contexto";
import { CriarProposta } from "./criar-proposta";
import { EstruturadoLeitura } from "./estruturado-leitura";
import { arimo, poppins } from "./fontes-folha";
import { LeituraFolha } from "./grade-folha";
import { HistoricoVersoes } from "./historico-versoes";
import { PainelProposta } from "./painel-proposta";

export const metadata = { title: "Proposta" };

const DATA_BR = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

/** "3 d 4 h", "5 h", "12 min" — tempo com a caneta. */
function duracao(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Proposta do Projeto (GAB-86): uma por Projeto. Quem está com a caneta
 * (GAB-87) vê o editor com autosave, a parte estruturada, "Salvar versão" e
 * as ações do pingue-pongue; o resto lê o rascunho atual e as versões —
 * transparência (§4.12) — e vê só as ações que lhe cabem (GP pega, projetos
 * marca inviável…). O servidor confere tudo de novo. Só abre para quem vê a proposta (GAB-98).
 */
export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const eu = await exigirUsuario();
  const { id } = await params;
  const r = await obterPropostaDoProjeto(id);
  if (!r) notFound();
  if (!(await podeVerPropostaDoProjeto(eu, id))) redirect("/403");
  const { projeto, proposta } = r;
  const pessoa = await pessoaDaCaneta(eu.id);
  // GAB-93: no quadro Projetos (depois do Ganho) a proposta está congelada: só leitura e comentários.
  const congelada = projeto.pipeline.chave === PIPELINE_PROJETOS;
  const cria = !congelada && !!pessoa && pessoa.ativo && podeCriarProposta(pessoa, projeto);
  const edita = !congelada && !!proposta && !!pessoa && podeEditarProposta(pessoa, proposta.estado);
  const acoes = !congelada && proposta && pessoa ? acoesPossiveis(pessoa, proposta.estado) : [];
  const lado = proposta ? ladoDaCaneta(proposta) : "VENDAS";
  const pessoas = acoes.some((a) => a === "passar" || a === "devolver") ? await listarPessoasDaCaneta() : [];
  // GAB-89: envio ao cliente (PDF da versão final, marcar enviada, resposta, concluir revisão).
  const envio = !congelada && proposta && pessoa ? acoesDeEnvio(pessoa, proposta.estado) : [];
  const versaoPdf = proposta ? versaoDoPdf(proposta, proposta.versoes[0]?.numero ?? null) : null;
  const caneta = {
    acoes,
    envio,
    versaoPdf,
    mesmoLado: pessoas.filter((p) => p.lado === lado && p.id !== eu.id),
    outroLado: pessoas.filter((p) => p.lado === outroLado(lado)),
    rotuloOutroLado: ROTULO_AREA[outroLado(lado)],
  };
  const tempos = proposta ? await tempoComCaneta(projeto.id) : [];
  // Quem está com a caneta e recebeu do outro lado: o diff do que o seu lado entregou para o que voltou.
  const ultima = proposta?.versoes[0];
  const minhaUltima = proposta?.versoes.find((v) => v.autorLado === lado);
  const voltou = proposta && proposta.canetaComId === eu.id && ultima && ultima.autorLado === outroLado(lado) ? { de: minhaUltima?.numero ?? null, para: ultima.numero } : null;
  // GAB-90: anexos para "Usar arquivo como base" (só quem está com a caneta edita e usa).
  const anexos = edita ? await listarAnexos(projeto.id) : [];
  // GAB-91: comentários (carga inicial; depois o polling do provider). JSON: datas como texto, como na API.
  const comentarios = proposta ? await listarComentarios(projeto.id, eu) : null;
  const comentariosIniciais = JSON.parse(JSON.stringify(comentarios ?? { versao: "", threads: [] })) as { versao: string; threads: ThreadJson[] };

  const capa: DadosCapa | undefined = proposta
    ? { empresa: projeto.empresa ?? projeto.titulo, data: dataPorExtenso(proposta.rascunhoEm ?? proposta.criadoEm), endereco: ENDERECO_IJ }
    : undefined;
  const lin = "flex items-baseline justify-between gap-3 py-0.5 text-[13px]";
  const cartaoProposta = proposta ? (
    <section className="rounded-xl border border-border bg-surface p-3" aria-label="Proposta">
      <h2 className="eyebrow mb-2">Proposta</h2>
      <div className={lin}>
        <span className="text-fg-mute">Com a caneta</span>
        <b className="min-w-0 truncate font-medium">{proposta.canetaCom ? (proposta.canetaCom.id === eu.id ? "Você" : proposta.canetaCom.nome) : "Ninguém"}</b>
      </div>
      <div className={lin}>
        <span className="text-fg-mute">Lado</span>
        <span>{ROTULO_AREA[lado]}</span>
      </div>
      <div className={lin}>
        <span className="text-fg-mute">Responsável</span>
        <span className="min-w-0 truncate">{projeto.responsavel.nome}</span>
      </div>
      {projeto.empresa ? (
        <div className={lin}>
          <span className="text-fg-mute">Empresa</span>
          <span className="min-w-0 truncate">{projeto.empresa}</span>
        </div>
      ) : null}
      <div className={lin}>
        <span className="text-fg-mute">Criada em</span>
        <span className="font-mono text-xs tabular">{DATA_BR.format(proposta.criadoEm)}</span>
      </div>
      {proposta.canetaDesde ? <p className="mt-1 text-xs text-fg-faint">Caneta desde {formatarDataHora(proposta.canetaDesde)}</p> : null}
      {!proposta.canetaCom && !["INVIAVEL", "ACEITA", "RECUSADA"].includes(proposta.status) ? <p className="mt-1 text-xs text-fg-faint">O GP de {ROTULO_AREA[lado].toLowerCase()} pega a caneta.</p> : null}
      {proposta.status === "INVIAVEL" ? <p className="mt-1 text-xs break-words text-fg-soft">Proposta inviável{proposta.motivoInviavel ? <>: “{proposta.motivoInviavel}”</> : null}</p> : null}
      {proposta.status === "ACEITA" || proposta.status === "RECUSADA" ? (
        <p className="mt-1 text-xs break-words text-fg-soft">
          Proposta {proposta.status === "ACEITA" ? "aceita pelo cliente" : "recusada pelo cliente"}
          {proposta.motivoRecusa ? <>: “{proposta.motivoRecusa}”</> : null}
        </p>
      ) : null}
      {voltou ? (
        <Link href={`/projetos/${projeto.id}/proposta/diff?${voltou.de ? `de=${voltou.de}&` : ""}para=${voltou.para}`} className="mt-2 block rounded-lg border border-warn/60 px-2 py-1 text-xs text-foreground hover:underline">
          Voltou para você: ver o que mudou {voltou.de ? `(v${voltou.de} → v${voltou.para})` : `(v${voltou.para})`}
        </Link>
      ) : null}
      {proposta.rascunhoEm ? (
        <p className="mt-2 text-xs text-fg-faint">
          Rascunho alterado por {proposta.rascunhoPor?.nome ?? "—"}
          {proposta.rascunhoViaMcp ? " (via MCP)" : ""} em {formatarDataHora(proposta.rascunhoEm)}.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-fg-faint">
        Criada por {proposta.criadoPor.nome} em {formatarDataHora(proposta.criadoEm)}.
      </p>
      {!edita && proposta.canetaComId !== eu.id ? <p className="mt-1 text-xs text-fg-faint">Só quem está com a caneta edita; você lê (e comenta).</p> : null}
    </section>
  ) : null;
  const cartoesFim = proposta ? (
    <>
      <section className="rounded-xl border border-border bg-surface p-3 text-sm" aria-label="Para enviar ao cliente">
        <h2 className="eyebrow mb-2">Para enviar ao cliente</h2>
        <ComentariosAbertos />
        <Marcador ok={["PRONTA_PARA_ENVIO", "ENVIADA", "ACEITA", "RECUSADA"].includes(proposta.status)} texto="Concordância dos dois lados" />
        <Marcador ok={proposta.versoes.length > 0} texto="Versão salva" valor={proposta.versoes[0] ? `v${proposta.versoes[0].numero}` : undefined} />
        {versaoPdf ? (
          <a href={urlPdfDaProposta("", projeto.id, versaoPdf)} download className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1 text-xs hover:bg-muted">
            Baixar PDF da proposta (v{versaoPdf})
          </a>
        ) : null}
        <ul className="mt-2 space-y-0.5 text-xs text-fg-mute empty:hidden">
          {proposta.status === "PRONTA_PARA_ENVIO" ? <li>Pronta: baixe, mande ao cliente pelo canal que quiser e marque como enviada.</li> : null}
          {proposta.enviadaEm && proposta.versaoEnviada ? (
            <li>
              v{proposta.versaoEnviada} enviada em {formatarDataHora(proposta.enviadaEm)}.
            </li>
          ) : null}
          {proposta.respondidaEm && proposta.status !== "ENVIADA" && proposta.status !== "PRONTA_PARA_ENVIO" ? (
            <li>
              Resposta do cliente em {formatarDataHora(proposta.respondidaEm)}
              {proposta.motivoRecusa ? <>: recusada — “{proposta.motivoRecusa}”</> : "."}
            </li>
          ) : null}
        </ul>
      </section>
      <HistoricoVersoes projetoId={projeto.id} versoes={proposta.versoes} />
      {tempos.length ? (
        <section className="rounded-xl border border-border bg-surface p-3">
          <h2 className="eyebrow mb-2">Tempo com a caneta</h2>
          <ul className="space-y-1 text-xs">
            {tempos.map((t) => (
              <li key={t.id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate text-fg-soft">{t.nome}</span>
                <span className="text-fg-faint">{ROTULO_AREA[t.lado].toLowerCase()}</span>
                <span className="w-14 text-right font-mono tabular">{duracao(t.ms)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  ) : null;

  return (
    <>
      <MarcarQuadroAtivo quadro={projeto.pipeline.chave} />
      <Link href={`/projetos/${projeto.id}`} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {projeto.titulo}
      </Link>

      <header className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow mb-1">
            proposta · {projeto.pipeline.chave}
            {projeto.fase.nome.toLowerCase() === "proposta" ? null : ` · ${projeto.fase.nome}`}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{projeto.titulo}</h1>
        </div>
        {proposta ? <StatusPropostaBadge status={proposta.status} className="text-[11px]" /> : null}
      </header>

      {!proposta ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <EstadoVazio
            mascote="notebook"
            titulo="Este projeto ainda não tem proposta"
            texto={congelada ? "O projeto já está no quadro Projetos: não há mais proposta a criar." : cria ? "Crie a proposta: o texto fica aqui, com versões, e a parte estruturada (valor, prazo, entregas) alimenta o contrato e a execução." : "Quem é de vendas e responsável pelo projeto (ou a gestão) cria a proposta."}
            acao={cria ? <CriarProposta projetoId={projeto.id} /> : undefined}
          />
        </section>
      ) : (
        <div className={`${arimo.variable} ${poppins.variable}`}>
          <ComentariosProvider projetoId={projeto.id} euId={eu.id} inicial={comentariosIniciais}>
            {edita ? (
              <PainelProposta
                // Sem `key` por revisão: o `router.refresh()` depois de salvar versão não pode
                // remontar o editor (perderia o que a pessoa digitou entretanto). O painel
                // guarda a própria revisão; conflito com quem gravou depois aparece nele.
                // `key` pela caneta/status (GAB-87): quando a caneta muda de mão ou o status
                // muda, o editor remonta com a revisão nova (a mudança incrementou a revisão).
                key={`${proposta.canetaComId}:${proposta.status}`}
                projetoId={projeto.id}
                revisao={proposta.revisao}
                documento={markdownParaDocumento(proposta.conteudoMd)}
                estruturado={estruturadoParaEntrada(proposta.estruturado)}
                ultimaVersao={proposta.versoes[0]?.numero ?? null}
                caneta={caneta}
                anexos={anexos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, semTexto: a.semTexto }))}
                capa={capa}
                cartaoProposta={cartaoProposta}
                cartoesFim={cartoesFim}
              />
            ) : (
              <LeituraFolha
                documento={markdownParaDocumento(proposta.conteudoMd)}
                dados={proposta.estruturado}
                capa={capa}
                direita={
                  <>
                    <AcoesCaneta
                      projetoId={projeto.id}
                      revisao={proposta.revisao}
                      {...caneta}
                      secundarias={
                        <a href={versaoPdf ? urlPdfDaProposta("", projeto.id, versaoPdf) : urlPreviaDaProposta("", projeto.id)} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
                          Ver PDF
                        </a>
                      }
                    />
                    {cartaoProposta}
                    <section className="rounded-xl border border-border bg-surface p-3" aria-label="Dados da proposta">
                      <h2 className="eyebrow mb-2">Dados da proposta</h2>
                      <EstruturadoLeitura e={proposta.estruturado} />
                    </section>
                    {cartoesFim}
                  </>
                }
              />
            )}
          </ComentariosProvider>
        </div>
      )}
    </>
  );
}
