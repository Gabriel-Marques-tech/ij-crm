import { pathToFileURL } from "node:url";
import { Marco, PrismaClient, TipoTerminal } from "@prisma/client";

type FaseSeed = {
  chave: string;
  nome: string;
  tipoTerminal?: TipoTerminal;
  cor?: string;
  limiteDiasAlerta?: number;
  /** GAB-81: marco fixo do ciclo único (ver src/lib/fases/marcos.ts). */
  marco?: Marco;
};

// Fases do Pipefy, na ordem (design doc §4.2), com os marcos do ciclo único (GAB-81,
// spec fase 2 §4.2): as fases de vendas da v1 são subfases antes de Proposta; as de
// projetos, subfases de Execução. Bancos que já existiam ganham os marcos pela
// migration 20261030130000_ciclo_unico (este seed não mexe em fases existentes).
export const PIPELINES: { chave: string; nome: string; ordem: number; fases: FaseSeed[] }[] = [
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
      { chave: "proposta", nome: "Proposta", cor: "#ffc857", limiteDiasAlerta: 10, marco: "PROPOSTA" },
      { chave: "montando_contrato", nome: "Montando Contrato", cor: "#b447eb", limiteDiasAlerta: 7, marco: "MONTANDO_CONTRATO" },
      { chave: "contrato_assinado", nome: "Contrato assinado", tipoTerminal: "GANHO", cor: "#1e9b6b", marco: "GANHO" },
      { chave: "perdido", nome: "Perdido", tipoTerminal: "PERDIDO", cor: "#6b7280", marco: "PERDIDO" },
    ],
  },
  {
    chave: "projetos",
    nome: "Projetos",
    ordem: 1,
    fases: [
      { chave: "handoff", nome: "Handoff", cor: "#8a5cf6", limiteDiasAlerta: 7, marco: "HANDOFF" },
      { chave: "execucao", nome: "Execução", cor: "#4cc9f0", marco: "EXECUCAO" },
      { chave: "em_execucao", nome: "Em execução", cor: "#4cc9f0" },
      { chave: "conclusao", nome: "Conclusão", cor: "#ffc857" },
      { chave: "coleta_dados", nome: "Coleta de dados", cor: "#ff8655" },
      { chave: "finalizado", nome: "Finalizado", tipoTerminal: "GANHO", cor: "#1e9b6b", marco: "FINALIZADO" },
    ],
  },
];

/**
 * Idempotente. Pipelines: upsert (nome/ordem). Fases: criadas SÓ junto com o
 * pipeline, na primeira instalação. Se o pipeline já existia, as fases são do
 * gestor (Gestão → Fases): re-seed não reordena, não renomeia, não desarquiva
 * e não ressuscita fase excluída.
 */
export async function semear(prisma: PrismaClient, opts: { log?: (msg: string) => void } = {}) {
  const log = opts.log ?? console.log;
  for (const p of PIPELINES) {
    const existente = await prisma.pipeline.findUnique({ where: { chave: p.chave }, select: { id: true } });
    if (existente) {
      await prisma.pipeline.update({ where: { id: existente.id }, data: { nome: p.nome, ordem: p.ordem } });
      log(`seed: pipeline ${p.chave} já existe — fases não tocadas`);
      continue;
    }
    await prisma.pipeline.create({
      data: {
        chave: p.chave,
        nome: p.nome,
        ordem: p.ordem,
        fases: {
          create: p.fases.map((f, ordem) => ({
            chave: f.chave,
            nome: f.nome,
            ordem,
            isTerminal: !!f.tipoTerminal,
            tipoTerminal: f.tipoTerminal ?? null,
            cor: f.cor ?? null,
            limiteDiasAlerta: f.limiteDiasAlerta ?? null,
            marco: f.marco ?? null,
          })),
        },
      },
    });
    log(`seed: pipeline ${p.chave} criado (${p.fases.length} fases)`);
  }
}

// Só roda quando executado diretamente (`prisma db seed` / `tsx prisma/seed.ts`), não ao ser importado em teste.
const executadoDiretamente = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  // `db` compartilhado: erros do Prisma já saem sem os argumentos da query (LGPD).
  void Promise.all([import("../src/lib/db"), import("../src/lib/erros/registrar")]).then(([{ db }, { mensagemSegura }]) =>
    semear(db)
      .catch((e) => {
        console.error(`seed falhou: ${mensagemSegura(e)}`);
        process.exitCode = 1;
      })
      .finally(() => db.$disconnect()),
  );
}
