import { PrismaClient, TipoTerminal } from "@prisma/client";

const prisma = new PrismaClient();

type FaseSeed = {
  chave: string;
  nome: string;
  tipoTerminal?: TipoTerminal;
  cor?: string;
  limiteDiasAlerta?: number;
};

// Fases do Pipefy, na ordem (design doc §4.2).
const PIPELINES: { chave: string; nome: string; ordem: number; fases: FaseSeed[] }[] = [
  {
    chave: "vendas",
    nome: "Vendas",
    ordem: 0,
    fases: [
      { chave: "primeiro_contato", nome: "Primeiro Contato", cor: "#8a5cf6", limiteDiasAlerta: 7 },
      { chave: "reuniao_diagnostica", nome: "Reunião Diagnóstica", cor: "#4cc9f0", limiteDiasAlerta: 10 },
      { chave: "reuniao_intermediaria", nome: "Reunião Intermediária", cor: "#f042b6", limiteDiasAlerta: 10 },
      { chave: "montando_proposta", nome: "Montando Proposta", cor: "#ff8655", limiteDiasAlerta: 7 },
      { chave: "reuniao_proposta", nome: "Reunião de Proposta", cor: "#ffc857", limiteDiasAlerta: 10 },
      { chave: "em_negociacao", nome: "Em negociação", cor: "#ff4d3a", limiteDiasAlerta: 14 },
      { chave: "montando_contrato", nome: "Montando Contrato", cor: "#b447eb", limiteDiasAlerta: 7 },
      { chave: "contrato_assinado", nome: "Contrato assinado", tipoTerminal: "GANHO", cor: "#1e9b6b" },
      { chave: "perdido", nome: "Perdido", tipoTerminal: "PERDIDO", cor: "#6b7280" },
    ],
  },
  {
    chave: "projetos",
    nome: "Projetos",
    ordem: 1,
    fases: [
      { chave: "em_execucao", nome: "Em execução", cor: "#4cc9f0" },
      { chave: "conclusao", nome: "Conclusão", cor: "#ffc857" },
      { chave: "coleta_dados", nome: "Coleta de dados", cor: "#ff8655" },
      { chave: "finalizado", nome: "Finalizado", tipoTerminal: "GANHO", cor: "#1e9b6b" },
    ],
  },
];

async function main() {
  for (const p of PIPELINES) {
    const pipeline = await prisma.pipeline.upsert({
      where: { chave: p.chave },
      update: { nome: p.nome, ordem: p.ordem },
      create: { chave: p.chave, nome: p.nome, ordem: p.ordem },
    });
    for (const [ordem, f] of p.fases.entries()) {
      await prisma.fase.upsert({
        where: { pipelineId_chave: { pipelineId: pipeline.id, chave: f.chave } },
        // Só cria. Depois do 1º seed a fase é do gestor (Gestão → Fases: ordem,
        // nome, cor, limite, terminal, arquivamento); re-seed não pode desfazer isso.
        update: {},
        create: {
          pipelineId: pipeline.id,
          chave: f.chave,
          nome: f.nome,
          ordem,
          isTerminal: !!f.tipoTerminal,
          tipoTerminal: f.tipoTerminal ?? null,
          cor: f.cor ?? null,
          limiteDiasAlerta: f.limiteDiasAlerta ?? null,
        },
      });
    }
    console.log(`seed: pipeline ${p.chave} (${p.fases.length} fases)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
