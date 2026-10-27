import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodificarArquivo } from "./csv";
import { interpretarCsv, type Interpretacao } from "./interpretar";

const FIX = path.resolve(import.meta.dirname, "../../../test/fixtures/pipefy");
const ler = (nome: string) => decodificarArquivo(readFileSync(path.join(FIX, nome)));

function ok(texto: string): Interpretacao {
  const r = interpretarCsv(texto);
  if (!r.ok) throw new Error(r.erro);
  return r;
}

describe("interpretarCsv — fixture pt-BR (; + BOM + multilinha)", () => {
  const r = ok(ler("export-exemplo.csv"));
  const card = (id: string) => r.cards.find((c) => c.pipefyId === id)!;

  it("lê o separador, conta linhas, deduplica e reporta a linha sem ID", () => {
    expect(r.separador).toBe(";");
    expect(r.totalLinhas).toBe(13);
    expect(r.cards.map((c) => c.pipefyId)).toEqual(["900001", "900002", "900003", "900004", "900005", "900006", "900007", "900008", "900009", "900010"]);
    expect(r.duplicadas).toBe(2);
    expect(r.erros).toEqual([{ linha: 14, pipefyId: null, mensagem: "Sem ID do card." }]);
  });

  it("repetido com conteúdo diferente: fica o atualizado por último, o outro vira aviso", () => {
    expect(card("900002").titulo).toBe("App de delivery Sabor Caseiro");
    expect(r.avisos).toContainEqual({ linha: 16, pipefyId: "900002", mensagem: "Card repetido no arquivo; mantida a linha 4 (atualizada por último)." });
  });

  it("campo multilinha com aspas e separador dentro", () => {
    expect(card("900001").dor).toBe('Site antigo; não aparece no Google.\nQuer receber pedidos "online".');
    expect(card("900003").titulo).toBe('Consultoria de ERP "Fase 2"');
  });

  it("normaliza CNPJ, telefone (sem DDI) e email; origem por etiqueta", () => {
    const c = card("900001");
    expect(c.cnpj).toBe("11222333000181");
    expect(c.pontos).toEqual([
      { tipo: "TELEFONE", valorNormalizado: "+5511988887777", valorOriginal: "(11) 98888-7777" },
      { tipo: "EMAIL", valorNormalizado: "jose@padariaaurora.com.br", valorOriginal: "jose@padariaaurora.com.br" },
    ]);
    expect(c.origem).toBe("INDICACAO");
    expect(card("900002").pontos[0].valorNormalizado).toBe("+552133334444");
    expect(card("900005").origem).toBe("COLD_CALL");
  });

  it("datas dd/mm/aaaa HH:mm (SP) e ISO; histórico por fase", () => {
    const c = card("900001");
    expect(c.criadoEm?.toISOString()).toBe("2026-01-02T12:15:00.000Z");
    expect(c.historico).toEqual([
      { chave: "primeiro contato", entrada: new Date("2026-01-02T12:15:00.000Z"), ultimaEntrada: null, saida: new Date("2026-01-10T17:30:00.000Z") },
      { chave: "reuniao diagnostica", entrada: new Date("2026-01-10T17:30:00.000Z"), ultimaEntrada: null, saida: null },
    ]);
    expect(card("900002").historico.map((h) => h.chave)).toEqual(["primeiro contato", "montando proposta", "contrato assinado"]);
    expect(card("900002").finalizadoEm?.toISOString()).toBe("2026-02-01T21:00:00.000Z");
  });

  it("valores em dinheiro e 1º responsável", () => {
    expect(card("900002")).toMatchObject({ orcamento: "50000.00", valorFechado: "45000.00", responsavel: "Bruno Lima" });
    expect(card("900003")).toMatchObject({ orcamento: "80000.00", valorFechado: "75500.50" });
    expect(r.avisos).toContainEqual({ linha: 4, pipefyId: "900002", mensagem: "Card com 2 responsáveis no Pipefy; o CRM usa o primeiro (Bruno Lima)." });
  });

  it("campos vazios viram null; data e CNPJ inválidos viram aviso", () => {
    expect(card("900008")).toMatchObject({ empresa: null, cnpj: null, pontos: [], criadoEm: null, responsavel: null, historico: [] });
    expect(card("900010")).toMatchObject({ criadoEm: null, cnpj: null });
    const avisos10 = r.avisos.filter((a) => a.pipefyId === "900010").map((a) => a.mensagem);
    expect(avisos10).toEqual(["CNPJ inválido (12.345.678/0001-00): ignorado.", 'Data inválida em "criadoEm" (31/02/2026 10:00): ignorada.']);
  });

  it("lista as fases do arquivo (atuais + cabeçalhos de histórico), com o nome com acento", () => {
    expect(r.fases).toEqual([
      { chave: "primeiro contato", nome: "Primeiro Contato", cardsAtuais: 3 },
      { chave: "reuniao diagnostica", nome: "Reunião Diagnóstica", cardsAtuais: 1 },
      { chave: "montando proposta", nome: "Montando Proposta", cardsAtuais: 1 },
      { chave: "contrato assinado", nome: "Contrato assinado", cardsAtuais: 1 },
      { chave: "em execucao", nome: "Em execução", cardsAtuais: 1 },
      { chave: "finalizado", nome: "Finalizado", cardsAtuais: 1 },
      { chave: "perdido", nome: "Perdido", cardsAtuais: 1 },
      { chave: "backlog antigo", nome: "Backlog antigo", cardsAtuais: 1 },
    ]);
  });

  it("colunas sem uso ficam listadas; tempo na fase é ignorado", () => {
    expect(r.colunasIgnoradas).toEqual(["Campo customizado sem uso"]);
    expect(r.colunasHistorico).toBe(9);
  });
});

describe("interpretarCsv — variante em inglês (vírgula, ISO)", () => {
  const r = ok(ler("export-exemplo-en.csv"));
  it("casa os cabeçalhos em inglês e o histórico First time in / Last time out", () => {
    expect(r.separador).toBe(",");
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0]).toMatchObject({ pipefyId: "800001", titulo: "Portal do aluno, versão 2", faseAtual: "primeiro contato", responsavel: "Ana Souza", origem: "INDICACAO" });
    expect(r.cards[1].historico).toEqual([
      { chave: "primeiro contato", entrada: new Date("2026-02-01T12:00:00Z"), ultimaEntrada: null, saida: new Date("2026-02-20T12:00:00Z") },
      { chave: "contrato assinado", entrada: new Date("2026-03-10T15:00:00Z"), ultimaEntrada: null, saida: null },
    ]);
  });
});

describe("interpretarCsv — erros de arquivo", () => {
  it("sem coluna obrigatória → erro dizendo quais nomes procurou", () => {
    const r = interpretarCsv("Nome;Valor\nx;1\n");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toMatch(/^Colunas obrigatórias não encontradas: ID do card \("Card ID", "ID", "Card id"\); Título/);
  });
  it("só cabeçalho", () => {
    expect(interpretarCsv("ID;Title;Current phase\n")).toEqual({ ok: false, erro: "O arquivo só tem o cabeçalho, nenhum card." });
  });
  it("limite de linhas", () => {
    const r = interpretarCsv("ID;Title;Current phase\n1;a;b\n2;c;d\n", { maxLinhas: 1 });
    expect(r).toEqual({ ok: false, erro: "O arquivo tem mais de 1 linhas de dados. Divida o export em partes menores." });
  });
  it("linha com colunas a mais → erro da linha, o resto segue", () => {
    const r = ok("ID;Title;Current phase\n1;a;b;sobrou\n2;c;d\n");
    expect(r.cards.map((c) => c.pipefyId)).toEqual(["2"]);
    expect(r.erros).toEqual([{ linha: 2, pipefyId: "1", mensagem: "Linha com 4 colunas; o cabeçalho tem 3. Confira o separador/aspas." }]);
  });
  it("linha com colunas a menos → erro da linha (colunas vazias no fim do cabeçalho não contam)", () => {
    const r = ok("ID;Title;Current phase;Empresa;;\n1;a;b\n2;c;d;X\n3;e;f;Y;;\n");
    expect(r.cards.map((c) => c.pipefyId)).toEqual(["2", "3"]);
    expect(r.erros).toEqual([{ linha: 2, pipefyId: "1", mensagem: "Linha com 3 colunas; o cabeçalho tem 4. Linha cortada? Confira o separador/aspas." }]);
  });
  it("título com mais de 200 caracteres → cortado com aviso, card segue", () => {
    const longo = "T".repeat(250);
    const r = ok(`ID;Title;Current phase\n1;${longo};Lead\n`);
    expect(r.cards[0].titulo).toBe("T".repeat(200));
    expect(r.avisos).toEqual([{ linha: 2, pipefyId: "1", mensagem: '"titulo" com mais de 200 caracteres: cortado.' }]);
  });
  it("no máximo 5 telefones e 5 emails por card; o resto vira aviso", () => {
    const tels = Array.from({ length: 7 }, (_, i) => `11 9000${i}-000${i}`).join(", ");
    const emails = Array.from({ length: 6 }, (_, i) => `a${i}@x.com`).join(", ");
    const r = ok(`ID;Title;Current phase;Telefone;Email\n1;a;Lead;"${tels}";"${emails}"\n`);
    const c = r.cards[0];
    expect(c.pontos.filter((p) => p.tipo === "TELEFONE")).toHaveLength(5);
    expect(c.pontos.filter((p) => p.tipo === "EMAIL")).toHaveLength(5);
    expect(r.avisos.map((a) => a.mensagem)).toEqual([
      "Card com 7 telefones; o import usa os 5 primeiros (11 90005-0005, 11 90006-0006 ignorados).",
      "Card com 6 emails; o import usa os 5 primeiros (a5@x.com ignorados).",
    ]);
  });
  it("valor 1.234 (ambíguo) é lido como milhar, com aviso", () => {
    const r = ok("ID;Title;Current phase;Orçamento previsto;Valor fechado\n1;a;Lead;1.234;R$ 2.500\n2;b;Lead;1.234,50;12500.5\n");
    expect(r.cards.map((c) => [c.orcamento, c.valorFechado])).toEqual([["1234.00", "2500.00"], ["1234.50", "12500.50"]]);
    expect(r.avisos.map((a) => [a.linha, a.mensagem])).toEqual([
      [2, 'Valor ambíguo em "orcamento" (1.234): lido como 1234,00 (ponto de milhar). Confira no Pipefy.'],
      [2, 'Valor ambíguo em "valorFechado" (R$ 2.500): lido como 2500,00 (ponto de milhar). Confira no Pipefy.'],
    ]);
  });
});

describe("interpretarCsv — coluna de descrição", () => {
  it("“Descrição”/“Description” vão para a descrição do card (não mais para a dor); Dor segue separada", () => {
    const r = ok('ID;Título;Fase atual;Dor;Descrição\n1;Padaria;Primeiro Contato;site lento;"Quer loja\nonline"\n2;Mercado;Primeiro Contato;;\n');
    expect(r.colunasReconhecidas).toEqual(expect.arrayContaining(["dor", "descricao"]));
    expect(r.cards.map((c) => [c.dor, c.descricao])).toEqual([
      ["site lento", "Quer loja\nonline"],
      [null, null],
    ]);
    const en = ok("Card ID,Title,Current phase,Description\n1,Padaria,Primeiro Contato,landing page\n");
    expect(en.cards[0]).toMatchObject({ dor: null, descricao: "landing page" });
  });
});
