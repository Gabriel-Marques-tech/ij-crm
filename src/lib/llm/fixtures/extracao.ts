/**
 * Fixtures da extração (GAB-34): mensagens realistas do grupo (pt-BR, gíria,
 * "15k", "uns 15 mil", "sexta", "semana que vem") com a saída estruturada
 * ESPERADA da LLM e o efeito esperado no CRM.
 *
 * Dois usos:
 * 1. Testes (`extracao.fixtures.int.test.ts`): o provedor `mock` devolve
 *    `saida` e o teste confere card, campos e a confirmação no grupo.
 * 2. Semente do benchmark (GAB-40): `texto` → `saida` é o rótulo esperado
 *    para comparar provedores/modelos reais com o mesmo prompt.
 *
 * Todas são "enviadas" por João (vendedor) em RECEBIDA_EM: sexta-feira
 * 24/10/2025, 09:00 em São Paulo.
 */
import type { Origem } from "@prisma/client";
import type { Extracao } from "../prompts/extracao.v1";

export const RECEBIDA_EM = new Date("2025-10-24T12:00:00Z");

export type EsperadoFixture =
  | {
      status: "PROCESSADA";
      titulo: string;
      fase: string;
      revisar: boolean;
      orcamento: string | null;
      proximaAcao: string | null;
      proximaAcaoEm: string | null;
      origem: Origem | null;
      responsavel: string;
      confirmacao: string;
    }
  | { status: "PENDENTE_REVISAO"; confirmacao: string };

export type FixtureExtracao = { nome: string; texto: string; saida: Extracao; esperado: EsperadoFixture };

const CAMPOS_VAZIOS: Extracao["campos"] = {
  origem: null,
  dor: null,
  orcamento_previsto: null,
  cidade: null,
  estado: null,
  proxima_acao: null,
  proxima_acao_em: null,
  motivo_perda: null,
  valor_fechado: null,
};

type Parcial = Partial<Omit<Extracao, "contato" | "empresa" | "campos">> & {
  contato?: Partial<Extracao["contato"]>;
  empresa?: Partial<Extracao["empresa"]>;
  campos?: Partial<Extracao["campos"]>;
};

/** Saída completa (todo campo presente, como o schema estrito exige) a partir do que importa. */
export function saida(p: Parcial): Extracao {
  return {
    intencao: p.intencao ?? "CRIAR",
    oportunidade_id: p.oportunidade_id ?? null,
    contato: { id: null, nome: null, telefone: null, email: null, ...p.contato },
    empresa: { id: null, nome: null, ...p.empresa },
    fase_chave: p.fase_chave ?? null,
    campos: { ...CAMPOS_VAZIOS, ...p.campos },
    responsavel_nome: p.responsavel_nome ?? null,
    confianca: p.confianca ?? 0.9,
    resumo: p.resumo ?? "Lead novo.",
  };
}

export const FIXTURES_EXTRACAO: FixtureExtracao[] = [
  {
    nome: "caso do ticket: contato + empresa + dor + 'uns 15k' + 'sexta'",
    texto: "#crm falei com o Gustavo da Economia Sensata, dor é relatório manual, orçamento uns 15k, mando proposta sexta",
    saida: saida({
      contato: { nome: "Gustavo" },
      empresa: { nome: "Economia Sensata" },
      campos: { dor: "relatório manual", orcamento_previsto: "uns 15k", proxima_acao: "mandar proposta", proxima_acao_em: "sexta" },
      confianca: 0.92,
      resumo: "Primeiro contato com Gustavo (Economia Sensata); proposta na sexta.",
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Gustavo — Economia Sensata",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: "15000.00",
      proximaAcao: "mandar proposta",
      proximaAcaoEm: "2025-10-31",
      origem: null,
      responsavel: "João",
      confirmacao: "✅ Gustavo — Economia Sensata → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)",
    },
  },
  {
    nome: "indicação com cidade/UF e 'uns 8 mil' + 'segunda'",
    texto: "#crm indicação do prof Marcos: Carla Mendes, da Padaria Pão Quente (Campinas/SP), quer site novo, uns 8 mil, ligar segunda",
    saida: saida({
      contato: { nome: "Carla Mendes" },
      empresa: { nome: "Padaria Pão Quente" },
      campos: { origem: "INDICACAO", dor: "site novo", orcamento_previsto: "uns 8 mil", cidade: "Campinas", estado: "SP", proxima_acao: "ligar", proxima_acao_em: "segunda" },
      confianca: 0.9,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Carla Mendes — Padaria Pão Quente",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: "8000.00",
      proximaAcao: "ligar",
      proximaAcaoEm: "2025-10-27",
      origem: "INDICACAO",
      responsavel: "João",
      confirmacao: "✅ Carla Mendes — Padaria Pão Quente → Primeiro Contato. Resp: João. Próx.: ligar (27/10)",
    },
  },
  {
    nome: "evento com telefone no texto e 'semana que vem'",
    texto: "#crm conheci a Bia na feira do empreendedor, ela é da TechNova, tel (11) 98888-7777, quer automatizar as planilhas. mandar email semana que vem",
    saida: saida({
      contato: { nome: "Bia", telefone: "(11) 98888-7777" },
      empresa: { nome: "TechNova" },
      campos: { origem: "EVENTO", dor: "automatizar planilhas", proxima_acao: "mandar email", proxima_acao_em: "semana que vem" },
      confianca: 0.88,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Bia — TechNova",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: null,
      proximaAcao: "mandar email",
      proximaAcaoEm: "2025-10-27",
      origem: "EVENTO",
      responsavel: "João",
      confirmacao: "✅ Bia — TechNova → Primeiro Contato. Resp: João. Próx.: mandar email (27/10)",
    },
  },
  {
    nome: "lead do RD com email, 'R$ 20.000' e fase inferida (reunião diagnóstica)",
    texto: "#CRM lead do RD: Fernando Lima, fernando@agrosol.com.br, da Agrosol, querem dashboard de vendas, R$ 20.000. Reunião diagnóstica marcada pra 30/10",
    saida: saida({
      contato: { nome: "Fernando Lima", email: "fernando@agrosol.com.br" },
      empresa: { nome: "Agrosol" },
      fase_chave: "reuniao_diagnostica",
      campos: { origem: "RD", dor: "dashboard de vendas", orcamento_previsto: "R$ 20.000", proxima_acao: "reunião diagnóstica", proxima_acao_em: "30/10" },
      confianca: 0.95,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Fernando Lima — Agrosol",
      fase: "reuniao_diagnostica",
      revisar: false,
      orcamento: "20000.00",
      proximaAcao: "reunião diagnóstica",
      proximaAcaoEm: "2025-10-30",
      origem: "RD",
      responsavel: "João",
      confirmacao: "✅ Fernando Lima — Agrosol → Reunião Diagnóstica. Resp: João. Próx.: reunião diagnóstica (30/10)",
    },
  },
  {
    nome: "só empresa (cold call) + 'amanhã'",
    texto: "#crm cold call na Metalúrgica Ferraz, ninguém atendeu direito, tentar de novo amanhã",
    saida: saida({
      empresa: { nome: "Metalúrgica Ferraz" },
      campos: { origem: "COLD_CALL", proxima_acao: "ligar de novo", proxima_acao_em: "amanhã" },
      confianca: 0.8,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Metalúrgica Ferraz",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: null,
      proximaAcao: "ligar de novo",
      proximaAcaoEm: "2025-10-25",
      origem: "COLD_CALL",
      responsavel: "João",
      confirmacao: "✅ Metalúrgica Ferraz → Primeiro Contato. Resp: João. Próx.: ligar de novo (25/10)",
    },
  },
  {
    nome: "só contato, confiança baixa → revisar",
    texto: "#crm a Juliana me chamou no insta, quer consultoria financeira pra loja dela, uns 5k",
    saida: saida({
      contato: { nome: "Juliana" },
      campos: { dor: "consultoria financeira para a loja", orcamento_previsto: "uns 5k" },
      confianca: 0.55,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Juliana",
      fase: "primeiro_contato",
      revisar: true,
      orcamento: "5000.00",
      proximaAcao: null,
      proximaAcaoEm: null,
      origem: null,
      responsavel: "João",
      confirmacao: "⚠️ Juliana → Primeiro Contato. Resp: João.\nMarquei para revisar: confiança baixa da leitura.",
    },
  },
  {
    nome: "sem nome nenhum → não cria, pede o nome",
    texto: "#crm falei com um cara hoje, parece interessado, depois vejo",
    saida: saida({ confianca: 0.3, resumo: "Contato sem identificação." }),
    esperado: { status: "PENDENTE_REVISAO", confirmacao: "⚠️ não identifiquei o lead — responde esta mensagem com o nome" },
  },
  {
    nome: "ATUALIZAR ainda não é aplicado → fila de revisão",
    texto: "#crm o Gustavo respondeu, vai fechar semana que vem",
    saida: saida({ intencao: "ATUALIZAR", contato: { nome: "Gustavo" }, campos: { proxima_acao_em: "semana que vem" }, confianca: 0.7 }),
    esperado: {
      status: "PENDENTE_REVISAO",
      confirmacao: "⚠️ atualizar card pelo WhatsApp ainda não está ativo; ficou na fila de revisão do CRM",
    },
  },
  {
    nome: "responsável por nome exato de usuário ativo, '1,5 milhão', 'dia 5'",
    texto: "#crm passei pra Maria: Roberto da Construtora Alicerce, obra precisa de controle de custos, orçamento 1,5 milhão (!!), visita dia 5",
    saida: saida({
      contato: { nome: "Roberto" },
      empresa: { nome: "Construtora Alicerce" },
      responsavel_nome: "maria",
      campos: { dor: "controle de custos da obra", orcamento_previsto: "1,5 milhão", proxima_acao: "visita", proxima_acao_em: "dia 5" },
      confianca: 0.85,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Roberto — Construtora Alicerce",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: "1500000.00",
      proximaAcao: "visita",
      proximaAcaoEm: "2025-11-05",
      origem: null,
      responsavel: "Maria",
      confirmacao: "✅ Roberto — Construtora Alicerce → Primeiro Contato. Resp: Maria. Próx.: visita (05/11)",
    },
  },
  {
    nome: "gíria, 'tipo 3 mil' e 'em 10 dias'",
    texto: "#crm mano, trampo novo: Lucas da Sorveteria Gelato, quer app de delivery, grana curta tipo 3 mil, retorno em 10 dias",
    saida: saida({
      contato: { nome: "Lucas" },
      empresa: { nome: "Sorveteria Gelato" },
      campos: { dor: "app de delivery", orcamento_previsto: "tipo 3 mil", proxima_acao: "dar retorno", proxima_acao_em: "em 10 dias" },
      confianca: 0.8,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Lucas — Sorveteria Gelato",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: "3000.00",
      proximaAcao: "dar retorno",
      proximaAcaoEm: "2025-11-03",
      origem: null,
      responsavel: "João",
      confirmacao: "✅ Lucas — Sorveteria Gelato → Primeiro Contato. Resp: João. Próx.: dar retorno (03/11)",
    },
  },
  {
    nome: "CNPJ no texto cria a empresa com CNPJ; 'fim do mês'",
    texto: "#crm Ana Paula da Acme Ltda, CNPJ 11.222.333/0001-81, quer BI pro financeiro. proposta até fim do mês",
    saida: saida({
      contato: { nome: "Ana Paula" },
      empresa: { nome: "Acme Ltda" },
      campos: { dor: "BI para o financeiro", proxima_acao: "mandar proposta", proxima_acao_em: "fim do mês" },
      confianca: 0.9,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Ana Paula — Acme Ltda",
      fase: "primeiro_contato",
      revisar: false,
      orcamento: null,
      proximaAcao: "mandar proposta",
      proximaAcaoEm: "2025-10-31",
      origem: null,
      responsavel: "João",
      confirmacao: "✅ Ana Paula — Acme Ltda → Primeiro Contato. Resp: João. Próx.: mandar proposta (31/10)",
    },
  },
  {
    nome: "fase terminal sugerida na criação → recusada, entra em Primeiro Contato + revisar",
    texto: "#crm fechamos com a Doceria Bom Bocado!! contrato assinado, 12k",
    saida: saida({
      empresa: { nome: "Doceria Bom Bocado" },
      fase_chave: "contrato_assinado",
      campos: { valor_fechado: "12k" },
      confianca: 0.85,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Doceria Bom Bocado",
      fase: "primeiro_contato",
      revisar: true,
      orcamento: null,
      proximaAcao: null,
      proximaAcaoEm: null,
      origem: null,
      responsavel: "João",
      confirmacao: "⚠️ Doceria Bom Bocado → Primeiro Contato. Resp: João.\nMarquei para revisar: fechamento (ganho/perdido) só pelo CRM.",
    },
  },
  {
    nome: "data não entendida ('quando der') → sem data + revisar",
    texto: "#crm Pedro da Ótica Visão quer site institucional, retorno quando der",
    saida: saida({
      contato: { nome: "Pedro" },
      empresa: { nome: "Ótica Visão" },
      campos: { dor: "site institucional", proxima_acao: "dar retorno", proxima_acao_em: "quando der" },
      confianca: 0.8,
    }),
    esperado: {
      status: "PROCESSADA",
      titulo: "Pedro — Ótica Visão",
      fase: "primeiro_contato",
      revisar: true,
      orcamento: null,
      proximaAcao: "dar retorno",
      proximaAcaoEm: null,
      origem: null,
      responsavel: "João",
      confirmacao: "⚠️ Pedro — Ótica Visão → Primeiro Contato. Resp: João. Próx.: dar retorno\nMarquei para revisar: data da próxima ação não entendida.",
    },
  },
  {
    nome: "IGNORAR com tag → fila de revisão",
    texto: "#crm teste 123",
    saida: saida({ intencao: "IGNORAR", confianca: 0.9, resumo: "Mensagem de teste." }),
    esperado: { status: "PENDENTE_REVISAO", confirmacao: "⚠️ não entendi como registro de venda; ficou na fila de revisão do CRM" },
  },
];
