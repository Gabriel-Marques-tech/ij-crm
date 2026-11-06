// @vitest-environment node
/**
 * Matriz papel × área no MCP (GAB-98, spec áreas §4.4 a §4.7): as mesmas regras da
 * tela em cada ferramenta, pela porta única. Cada `it` parte de um banco limpo.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { criarProposta, passarCaneta } from "@/lib/propostas/propostas";
import { MATRIZ, semearVisibilidade, type Mundo, type Persona } from "@/test/visibilidade";
import { executarFerramenta, FERRAMENTAS, SO_LEITURA } from "./ferramentas";
import { autenticarAcesso } from "./oauth";

let m: Mundo;
const corpo = (r: Awaited<ReturnType<typeof executarFerramenta>>) => (r.content as { text: string }[])[0].text;
const SEM_ACESSO = /não tem acesso|acesso à proposta/;
const FORA = /outra área/;

beforeEach(async () => {
  m = await semearVisibilidade();
});

async function roda(nome: string, args: unknown, eu: Persona) {
  const r = await executarFerramenta(nome, args, eu);
  return { erro: r.isError === true, texto: corpo(r) };
}

/** Quem está com uma proposta no card de Vendas: a dona (responsável), com a caneta. */
async function comProposta() {
  const r = await criarProposta(m.cardV.id, m.p.donoV);
  if (!r.ok) throw new Error(r.erro);
}

describe.each(MATRIZ)("matriz MCP: $nome", ({ nome, escreve, editaVendas, editaProjetos, todasPropostas }) => {
  const recusaEdicao = (podia: boolean) => (r: { erro: boolean; texto: string }) => {
    if (!escreve) expect(r.texto).toBe(SO_LEITURA);
    else if (podia) expect(r.texto).not.toMatch(FORA);
    else {
      expect(r.erro).toBe(true);
      expect(r.texto).toMatch(FORA);
    }
  };

  it("mover e editar dados: só a área dona", async () => {
    const eu = m.p[nome];
    for (const [card, podia, destino] of [
      [m.cardV, editaVendas, m.fase("em_negociacao").id],
      [m.cardP, editaProjetos, m.fase("execucao").id],
    ] as const) {
      recusaEdicao(podia)(await roda("mover_projeto", { id: card.id, fase_id: destino }, eu));
      recusaEdicao(podia)(await roda("atualizar_projeto", { id: card.id, campos: { cidade: "Santos" } }, eu));
      recusaEdicao(podia)(await roda("definir_proxima_acao", { id: card.id, acao: "Ligar", data: "2030-01-10" }, eu));
      recusaEdicao(podia)(await roda("vincular_empresa_contato", { id: card.id, campo: "empresa", alvo_id: "" }, eu));
      const atual = await m.db.projeto.findUniqueOrThrow({ where: { id: card.id } });
      expect(atual.cidade).toBe(podia ? "Santos" : null);
      expect(atual.faseId).toBe(podia ? destino : card.faseId);
    }
  });

  it("criar card: só no quadro da própria área", async () => {
    const eu = m.p[nome];
    recusaEdicao(editaVendas)(await roda("criar_projeto", { titulo: "Novo", quadro: "vendas" }, eu));
    recusaEdicao(editaProjetos)(await roda("criar_projeto", { titulo: "Novo", quadro: "projetos" }, eu));
  });

  it("comentar e criar prazo em card de qualquer área: quem escreve", async () => {
    const eu = m.p[nome];
    for (const card of [m.cardV, m.cardP]) {
      const nota = await roda("registrar_nota", { id: card.id, texto: "De fora" }, eu);
      const prazo = await roda("criar_prazo", { titulo: "Prazo", dia: "2030-01-10", projeto_id: card.id }, eu);
      if (escreve) {
        expect(nota.erro).toBe(false);
        expect(prazo.erro).toBe(false);
      } else {
        expect(nota.texto).toBe(SO_LEITURA);
        expect(prazo.texto).toBe(SO_LEITURA);
      }
    }
  });

  it("proposta sem estar escalado: leitura, versões, diff, PDF e comentários seguem a regra", async () => {
    await comProposta();
    const eu = m.p[nome];
    const leituras: [string, object][] = [
      ["ler_proposta", {}],
      ["listar_versoes_proposta", {}],
      ["ler_versao_proposta", { numero: 1 }],
      ["ver_diff_proposta", {}],
      ["gerar_pdf_proposta", {}],
      ["listar_comentarios_proposta", {}],
      ["comentar_proposta", { texto: "oi" }],
      ["sugerir_texto_proposta", { trecho: "x", texto_novo: "y" }],
      ["adicionar_a_revisao_proposta", { texto: "oi" }],
      ["enviar_revisao_proposta", {}],
    ];
    for (const [ferramenta, extra] of leituras) {
      const r = await roda(ferramenta, { projeto_id: m.cardV.id, ...extra }, eu);
      if (todasPropostas) expect(r.texto, ferramenta).not.toMatch(SEM_ACESSO);
      else {
        expect(r.erro, ferramenta).toBe(true);
        expect(r.texto, ferramenta).toMatch(SEM_ACESSO);
      }
    }
  });

  it("escalado pelo card (responsável) vê a proposta; visualizador continua sem ver", async () => {
    await comProposta();
    const eu = m.p[nome];
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { responsavelId: eu.id } });
    const r = await roda("ler_proposta", { projeto_id: m.cardV.id }, eu);
    expect(r.erro).toBe(!escreve);
  });

  it("ler_projeto: sem acesso à proposta, sem os eventos dela nem o link", async () => {
    await comProposta();
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { propostaUrl: "https://docs.exemplo/proposta" } });
    const r = await roda("ler_projeto", { id: m.cardV.id }, m.p[nome]);
    const dados = JSON.parse(r.texto) as { campos: { propostaUrl: string | null }; timeline: { tipo: string }[] };
    expect(dados.campos.propostaUrl).toBe(todasPropostas ? "https://docs.exemplo/proposta" : null);
    expect(dados.timeline.some((t) => t.tipo === "PROPOSTA")).toBe(todasPropostas);
  });
});

describe("MCP: casos que a matriz não cobre", () => {
  it("o ator autenticado traz área e cargos: gestor sem área não perde as duas áreas, GP é reconhecido", async () => {
    const { createHash } = await import("node:crypto");
    const token = "a".repeat(64);
    const cliente = await m.db.oauthCliente.create({ data: { id: "cliente", nome: "Teste", redirectUris: [] } });
    await m.db.mcpConexao.create({
      data: {
        clienteId: cliente.id,
        usuarioId: m.p.gpProjetos.id,
        escopo: "crm",
        acessoHash: createHash("sha256").update(token).digest("hex"),
        refreshHash: "b".repeat(64),
        acessoExpiraEm: new Date(Date.now() + 60_000),
        refreshExpiraEm: new Date(Date.now() + 60_000),
      },
    });
    const s = await autenticarAcesso(token);
    expect(s?.usuario).toEqual({ id: m.p.gpProjetos.id, nome: "GP Projetos", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"] });
  });

  it("responsável fora da área edita e move; quem é da mesma área de fora do card, conforme a área", async () => {
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { responsavelId: m.p.membroProjetos.id } });
    expect((await roda("atualizar_projeto", { id: m.cardV.id, campos: { cidade: "Santos" } }, m.p.membroProjetos)).erro).toBe(false);
    expect((await roda("mover_projeto", { id: m.cardV.id, fase_id: m.fase("em_negociacao").id }, m.p.membroProjetos)).erro).toBe(false);
  });

  it("card inexistente não vira recusa de área: a mensagem é a de sempre", async () => {
    expect((await roda("mover_projeto", { id: "nao-existe", fase_id: m.fase("em_negociacao").id }, m.p.membroProjetos)).texto).toMatch(/não encontrad/i);
  });

  it("pingue-pongue inteiro: quem recebe a caneta abre; ex-dono continua vendo; envio, aceite e contrato; vendedor age depois do Ganho", async () => {
    const { db, cardV, p } = m;
    const id = cardV.id;
    await roda("criar_proposta", { projeto_id: id }, p.donoV);
    expect((await roda("ler_proposta", { projeto_id: id }, p.vendedor)).texto).toMatch(SEM_ACESSO);

    // Dona passa para o vendedor: ele passa a abrir, sem mais nada.
    expect((await roda("passar_caneta_proposta", { projeto_id: id, para_id: p.vendedor.id }, p.donoV)).erro).toBe(false);
    expect((await roda("ler_proposta", { projeto_id: id }, p.vendedor)).erro).toBe(false);
    const revisao = () => db.proposta.findUniqueOrThrow({ where: { projetoId: id }, select: { revisao: true } }).then((x) => x.revisao);
    expect((await roda("editar_proposta", { projeto_id: id, revisao: await revisao(), markdown: "## Escopo\n\nSite", valor: "1.000,00" }, p.vendedor)).erro).toBe(false);

    // Devolve a alguém de Projetos que nunca viu a proposta.
    expect((await roda("ler_proposta", { projeto_id: id }, p.membroProjetos)).texto).toMatch(SEM_ACESSO);
    expect((await roda("devolver_proposta", { projeto_id: id, revisao: await revisao(), para_id: p.membroProjetos.id }, p.vendedor)).erro).toBe(false);
    const lida = JSON.parse((await roda("ler_proposta", { projeto_id: id }, p.membroProjetos)).texto) as { voceEstaComACaneta: boolean };
    expect(lida.voceEstaComACaneta).toBe(true);
    // Ex-donos (a dona e o vendedor) continuam lendo.
    expect((await roda("ler_proposta", { projeto_id: id }, p.donoV)).erro).toBe(false);
    expect((await roda("ver_diff_proposta", { projeto_id: id }, p.vendedor)).erro).toBe(false);

    // Consenso → pronta; vendas envia; cliente aceita; contrato assinado pela responsável.
    expect((await roda("concordar_proposta", { projeto_id: id, revisao: await revisao() }, p.membroProjetos)).erro).toBe(false);
    expect((await roda("gerar_pdf_proposta", { projeto_id: id }, p.vendedor)).erro).toBe(false);
    expect((await roda("marcar_proposta_enviada", { projeto_id: id }, p.vendedor)).erro).toBe(false);
    expect((await roda("registrar_resposta_proposta", { projeto_id: id, resposta: "aceita" }, p.vendedor)).erro).toBe(false);

    // Projetos não leva a Ganho um card de Vendas; a responsável leva.
    expect((await roda("marcar_contrato_assinado", { id, valor_fechado: "1.000,00" }, p.membroProjetos)).texto).toMatch(FORA);
    expect((await roda("marcar_contrato_assinado", { id, valor_fechado: "1.000,00" }, p.donoV)).erro).toBe(false);
    expect(await db.projeto.findUniqueOrThrow({ where: { id }, select: { pipeline: { select: { chave: true } }, responsavelId: true } })).toEqual({ pipeline: { chave: "projetos" }, responsavelId: p.donoV.id });

    // Depois do Ganho o card é de Projetos: a vendedora responsável segue agindo, o outro vendedor não.
    expect((await roda("atualizar_projeto", { id, campos: { cidade: "Santos" } }, p.donoV)).erro).toBe(false);
    expect((await roda("mover_projeto", { id, fase_id: m.fase("execucao").id }, p.donoV)).erro).toBe(false);
    expect((await roda("atualizar_projeto", { id, campos: { cidade: "Ubatuba" } }, p.vendedor)).texto).toMatch(FORA);
    expect((await roda("atualizar_projeto", { id, campos: { cidade: "Ubatuba" } }, p.membroProjetos)).erro).toBe(false);
  });

  it("tempo com a caneta (GAB-96): sem acesso às propostas, recusa; quem não está escalado não vê a proposta dos outros", async () => {
    await comProposta();
    const visual = await roda("consultar_tempo_caneta_proposta", {}, m.p.visualizador);
    expect(visual.erro).toBe(true);
    expect(visual.texto).toMatch(/não tem acesso às propostas/);
    const fora = await roda("consultar_tempo_caneta_proposta", {}, m.p.membroProjetos);
    expect(fora.erro).toBe(false);
    expect(fora.texto).not.toContain(m.cardV.titulo);
    const gp = await roda("consultar_tempo_caneta_proposta", {}, m.p.gpProjetos);
    expect(gp.texto).toContain(m.cardV.titulo);
  });

  it("toda ferramenta de proposta recusa quem não está escalado (nenhuma ficou sem guarda)", async () => {
    await comProposta();
    const comProjeto = FERRAMENTAS.filter((f) => "projeto_id" in f.entrada && f.nome !== "criar_proposta" && f.nome !== "criar_prazo" && f.nome !== "listar_anexos");
    expect(comProjeto.length).toBeGreaterThan(15);
    const base = { projeto_id: m.cardV.id, revisao: 0, para_id: m.p.gpProjetos.id, numero: 1, motivo: "x", resposta: "aceita", texto: "oi", anexo_id: "x", trecho: "x", texto_novo: "y" };
    for (const f of comProjeto) {
      const r = await roda(f.nome, base, m.p.membroProjetos);
      if (f.nome === "comentar_proposta") expect(r.texto, f.nome).toMatch(/acesso à proposta/);
      else expect(r.texto, f.nome).toMatch(SEM_ACESSO);
    }
  });

  it("toda ferramenta de escrita com `id` recusa quem é de fora da área (nenhuma ficou sem guarda)", async () => {
    // Regra própria, em que o de fora também age ou que o serviço decide. Ferramenta nova não entra aqui sem motivo.
    const SEM_AREA: Record<string, string> = {
      registrar_nota: "comentar vale para todo mundo que escreve",
      designar_gp_projeto: "só o GP de projetos, no serviço",
      escrever_resumo_handoff: "é do lado vendas, no serviço",
    };
    const comId = FERRAMENTAS.filter((f) => f.escrita && "id" in f.entrada && !(f.nome in SEM_AREA));
    expect(comId.map((f) => f.nome)).toEqual(expect.arrayContaining(["marcar_entrega", "ajustar_data_entrega", "cancelar_entrega", "adicionar_entrega", "copiar_cronograma_proposta", "registrar_checkin"]));
    const base = { id: m.cardP.id, entrega_id: "x", dia: "2030-01-10", motivo: "x", titulo: "x", status: "VERDE", campos: { cidade: "x" }, acao: "x", data: "2030-01-10", fase_id: m.fase("execucao").id, campo: "empresa", alvo_id: "", item: "kickoff", feito: true, anexo_id: "x" };
    for (const f of comId) expect(f.guarda, f.nome).toBeDefined();
    // Checklist de handoff é etapa conjunta com Vendas: tem guarda própria, e esse vendedor passa nela.
    const CONJUNTAS = ["marcar_item_handoff", "definir_contrato_handoff"];
    for (const f of comId.filter((x) => !CONJUNTAS.includes(x.nome))) expect((await roda(f.nome, base, m.p.vendedor)).texto, f.nome).toMatch(FORA);
  });

  it("GP designado do projeto está escalado na proposta, na leitura e na lista; quem não é segue de fora", async () => {
    await comProposta();
    const { filtroPropostasVisiveis } = await import("@/lib/propostas/acesso");
    const lista = (eu: Persona) => m.db.proposta.count({ where: { projetoId: m.cardV.id, ...filtroPropostasVisiveis(eu) } });
    expect((await roda("ler_proposta", { projeto_id: m.cardV.id }, m.p.membroProjetos)).texto).toMatch(SEM_ACESSO);
    expect(await lista(m.p.membroProjetos)).toBe(0);
    await m.db.projetoHandoff.create({ data: { projetoId: m.cardV.id, gpProjetoId: m.p.membroProjetos.id } });
    expect((await roda("ler_proposta", { projeto_id: m.cardV.id }, m.p.membroProjetos)).erro).toBe(false);
    expect(await lista(m.p.membroProjetos)).toBe(1);
    expect((await roda("ler_proposta", { projeto_id: m.cardV.id }, m.p.vendedor)).texto).toMatch(SEM_ACESSO);
    expect(await lista(m.p.visualizador)).toBe(0);
  });

  it("comentário por id: responder, resolver e reabrir dizem só \"não encontrado\" a quem não vê (GAB-101); quem vê, comenta", async () => {
    await comProposta();
    const { comentario } = (await (await import("@/lib/propostas/comentarios")).comentar(m.cardV.id, { texto: "oi" }, m.p.donoV)) as { comentario: { id: string } };
    for (const quem of [m.p.visualizador, m.p.membroProjetos]) {
      expect((await roda("responder_comentario_proposta", { comentario_id: comentario.id, texto: "x" }, quem)).texto).toMatch(/^Comentário não encontrado/);
      expect((await roda("resolver_comentario_proposta", { comentario_id: comentario.id }, quem)).texto).toMatch(/^Comentário não encontrado/);
      expect((await roda("reabrir_comentario_proposta", { comentario_id: comentario.id }, quem)).texto).toMatch(/^Comentário não encontrado/);
    }
    expect((await roda("resolver_comentario_proposta", { comentario_id: comentario.id }, m.p.gpProjetos)).erro).toBe(false);
    await passarCaneta(m.cardV.id, m.p.vendedor.id, m.p.donoV);
    expect((await roda("comentar_proposta", { projeto_id: m.cardV.id, texto: "recebi" }, m.p.vendedor)).erro).toBe(false);
  });

  it("trocar o responsável: nem quem é da área se coloca sem ser o atual, o GP ou a gestão (e assim não abre a proposta)", async () => {
    await comProposta();
    const { id } = m.cardV;
    const trocar = (para: string, quem: Persona) => roda("atualizar_projeto", { id, campos: { responsavelId: para } }, quem);
    expect((await trocar(m.p.vendedor.id, m.p.vendedor)).texto).toMatch(/Trocar o responsável/);
    expect((await roda("ler_proposta", { projeto_id: id }, m.p.vendedor)).texto).toMatch(SEM_ACESSO);
    expect((await trocar(m.p.membroProjetos.id, m.p.membroProjetos)).texto).toMatch(FORA);
    expect((await trocar(m.p.gpProjetos.id, m.p.gpProjetos)).texto).toMatch(FORA);
    expect((await trocar(m.p.gestorProjetos.id, m.p.gestorProjetos)).texto).toMatch(FORA);
    expect((await trocar(m.p.vendedor.id, m.p.gpVendas)).erro).toBe(false);
    expect((await trocar(m.p.gestorVendas.id, m.p.vendedor)).erro).toBe(false); // agora ele é o atual
    expect((await trocar(m.p.donoV.id, m.p.gestorVendas)).erro).toBe(false);
    expect((await trocar(m.p.admin.id, m.p.gestorSemArea)).erro).toBe(false);
    expect((await trocar(m.p.donoV.id, m.p.admin)).erro).toBe(false);
  });

  it("propostaUrl: quem não vê a proposta não grava; quem vê, grava", async () => {
    await comProposta();
    const url = { id: m.cardV.id, campos: { propostaUrl: "https://docs.exemplo/x" } };
    expect((await roda("atualizar_projeto", url, m.p.vendedor)).texto).toMatch(SEM_ACESSO);
    expect((await roda("atualizar_projeto", url, m.p.donoV)).erro).toBe(false);
  });

  it("criar_projeto sem quadro usa a área da pessoa; sem lado, vendas; recusa cita o parâmetro", async () => {
    const quadroDe = async (r: { texto: string }) => (await m.db.projeto.findUniqueOrThrow({ where: { id: (JSON.parse(r.texto) as { id: string }).id }, select: { pipeline: { select: { chave: true } } } })).pipeline.chave;
    expect(await quadroDe(await roda("criar_projeto", { titulo: "A" }, m.p.membroProjetos))).toBe("projetos");
    expect(await quadroDe(await roda("criar_projeto", { titulo: "B" }, m.p.vendedor))).toBe("vendas");
    expect(await quadroDe(await roda("criar_projeto", { titulo: "C" }, m.p.gestorSemArea))).toBe("vendas");
    expect((await roda("criar_projeto", { titulo: "D", quadro: "vendas" }, m.p.membroProjetos)).texto).toMatch(/`quadro`/);
  });

  it("motivo de inviável: o card novo não guarda; linha antiga é mascarada para quem não vê a proposta", async () => {
    await comProposta();
    const { id } = m.cardV;
    await m.db.proposta.update({ where: { projetoId: id }, data: { canetaLado: "PROJETOS", canetaComId: null, status: "EM_ANALISE" } });
    expect((await roda("marcar_proposta_inviavel", { projeto_id: id, motivo: "Segredo do escopo" }, m.p.gpProjetos)).erro).toBe(false);
    const gravado = await m.db.projeto.findUniqueOrThrow({ where: { id }, select: { motivoPerda: true, timeline: { where: { tipo: "CAMPO_ALTERADO" }, select: { payload: true } } } });
    expect(gravado.motivoPerda).toBe("Outro: Proposta inviável");
    expect(JSON.stringify(gravado.timeline)).not.toContain("Segredo");
    expect((await m.db.proposta.findUniqueOrThrow({ where: { projetoId: id } })).motivoInviavel).toBe("Segredo do escopo");

    // Linha de antes do GAB-98, no card e na Timeline.
    const antigo = "Outro: Proposta inviável: Segredo do escopo";
    await m.db.projeto.update({ where: { id }, data: { motivoPerda: antigo } });
    await m.db.timeline.create({ data: { projetoId: id, tipo: "CAMPO_ALTERADO", payload: { campo: "motivoPerda", antes: null, depois: antigo } } });
    const fora = await roda("ler_projeto", { id, timeline: 50 }, m.p.vendedor);
    expect(fora.texto).not.toContain("Segredo");
    expect((JSON.parse(fora.texto) as { campos: { motivoPerda: string } }).campos.motivoPerda).toBe("Outro: Proposta inviável");
    expect((await roda("ler_projeto", { id, timeline: 50 }, m.p.gpProjetos)).texto).toContain("Segredo");
  });

  it("recusa do cliente: o detalhe continua no card", async () => {
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { motivoPerda: "Preço: achou caro" } });
    const r = await roda("ler_projeto", { id: m.cardV.id }, m.p.vendedor);
    expect((JSON.parse(r.texto) as { campos: { motivoPerda: string } }).campos.motivoPerda).toBe("Preço: achou caro");
  });

  it("handoff: etapa conjunta nos itens e no contrato; Execução segue a área dona; resumo continua de vendas", async () => {
    const { id } = m.cardP;
    const item = { id, item: "kickoff", feito: true };
    for (const quem of [m.p.vendedor, m.p.gestorVendas]) {
      expect((await roda("marcar_item_handoff", item, quem)).erro).toBe(false);
      expect((await roda("definir_contrato_handoff", { id, anexo_id: "x" }, quem)).texto).not.toMatch(FORA);
      expect((await roda("mover_para_execucao", { id }, quem)).texto).toMatch(FORA);
    }
    expect((await roda("marcar_item_handoff", item, m.p.visualizador)).texto).toBe(SO_LEITURA);
    expect((await roda("marcar_item_handoff", item, m.p.membroProjetos)).erro).toBe(false);
    expect((await roda("marcar_item_handoff", item, m.p.donoP)).erro).toBe(false);
    expect((await roda("escrever_resumo_handoff", { id, contexto: "Da venda" }, m.p.vendedor)).texto).not.toMatch(FORA);
  });

  it("Painel segue aberto: VISUALIZADOR e membro de Projetos consultam", async () => {
    expect((await roda("consultar_painel_vendas", { indicador: "conversao" }, m.p.visualizador)).erro).toBe(false);
    expect((await roda("consultar_painel_vendas", { indicador: "conversao" }, m.p.membroProjetos)).erro).toBe(false);
  });
});
