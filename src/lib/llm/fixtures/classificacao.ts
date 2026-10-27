/**
 * Fixtures do classificador (GAB-39): 20 mensagens do grupo SEM `#crm` —
 * 10 de venda e 10 de conversa do grupo, em pt-BR informal — com a saída
 * ESPERADA (`relevante`, `confianca`).
 *
 * Dois usos, como `extracao.ts`:
 * 1. Testes: o provedor `mock` devolve `saida` para o texto igual
 *    (`classificacao.test.ts` confere a decisão de descarte de cada uma).
 * 2. Semente do benchmark (GAB-40): rótulo para comparar modelos reais com o
 *    mesmo prompt (`classificacao.v1.ts`).
 *
 * Nenhuma tem menos de 8 caracteres: as triviais nem chegam à LLM
 * (`ruidoObvio` em `src/lib/whatsapp/sem-tag.ts`).
 */
import type { Classificacao } from "../prompts/classificacao.v1";

export type FixtureClassificacao = { nome: string; texto: string; saida: Classificacao };

export const FIXTURES_CLASSIFICACAO: FixtureClassificacao[] = [
  // ---- relevantes (10)
  { nome: "lead novo com empresa e próximo passo", texto: "falei agora com o Rafael da Padaria Pão Quente, quer site novo, mando proposta sexta", saida: { relevante: true, confianca: 0.95 } },
  { nome: "reunião marcada", texto: "marquei diagnóstico com a Bianca da Clínica Sorriso pra terça 14h", saida: { relevante: true, confianca: 0.93 } },
  { nome: "proposta enviada com valor", texto: "mandei a proposta pro pessoal da Construtora Alfa, uns 18k", saida: { relevante: true, confianca: 0.9 } },
  { nome: "fechou", texto: "FECHAMOS com a Escola Crescer!!! 22 mil, assinam amanhã", saida: { relevante: true, confianca: 0.97 } },
  { nome: "perdeu", texto: "a Ótica Visão desistiu, disseram que tá caro e vão fazer interno", saida: { relevante: true, confianca: 0.9 } },
  { nome: "contato com telefone", texto: "lead do RD: Carla Mendes 11 98765-4321, quer consultoria financeira", saida: { relevante: true, confianca: 0.92 } },
  { nome: "follow-up de lead existente", texto: "o Gustavo da Economia Sensata respondeu, pediu pra ligar semana que vem", saida: { relevante: true, confianca: 0.88 } },
  { nome: "indicação", texto: "a mãe da Ju indicou a loja dela (Moda Bella), vou ligar amanhã cedo", saida: { relevante: true, confianca: 0.85 } },
  { nome: "negociação", texto: "Hotel Mirante pediu desconto de 10%, vou ver com a diretoria e volto pra eles", saida: { relevante: true, confianca: 0.86 } },
  { nome: "evento", texto: "conheci o dono da Cervejaria Lúpulo na feira de ontem, ficou de mandar email com o escopo", saida: { relevante: true, confianca: 0.84 } },

  // ---- ruído do grupo (10)
  { nome: "bom dia", texto: "bom diaaa time, bora que hoje é sexta 🚀", saida: { relevante: false, confianca: 0.98 } },
  { nome: "piada", texto: "kkkkkkk o print do Pedro dormindo na reunião", saida: { relevante: false, confianca: 0.97 } },
  { nome: "logística interna", texto: "alguém sabe se a sala 3 tá livre amanhã? preciso pro treinamento", saida: { relevante: false, confianca: 0.93 } },
  { nome: "reunião do time", texto: "galera, reunião geral de vendas às 18h no meet, não esqueçam", saida: { relevante: false, confianca: 0.9 } },
  { nome: "pergunta genérica", texto: "como vcs fazem pra achar o decisor quando ligam pra empresa grande?", saida: { relevante: false, confianca: 0.8 } },
  { nome: "link", texto: "olha esse artigo sobre cold call https://exemplo.com/artigo-vendas", saida: { relevante: false, confianca: 0.9 } },
  { nome: "comida", texto: "quem vai no almoço do RU hoje? tô indo 12h30", saida: { relevante: false, confianca: 0.97 } },
  { nome: "parabéns", texto: "parabéns Lari pela promoção!!! 🎉🎉", saida: { relevante: false, confianca: 0.95 } },
  { nome: "aviso de material", texto: "subi o modelo novo de proposta no drive, usem esse a partir de agora", saida: { relevante: false, confianca: 0.75 } },
  { nome: "meta vaga", texto: "faltam 3 contratos pra bater a meta do mês, bora gente", saida: { relevante: false, confianca: 0.7 } },
];
