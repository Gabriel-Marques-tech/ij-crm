import { chaveAnthropic, chaveGemini, chaveOpenAI, diagnosticarSegredo } from "@/lib/config/env";

export type EstadoSegredo = "configurada" | "ausente" | "fraca";

/** Segredos do env para o Admin (só o estado, nunca o valor). */
export function estadoSegredos(): { nome: string; estado: EstadoSegredo }[] {
  const forte = (nome: string): EstadoSegredo => {
    const d = diagnosticarSegredo(nome);
    return d.ok ? "configurada" : d.motivo === "AUSENTE" ? "ausente" : "fraca";
  };
  const presente = (v: string | undefined): EstadoSegredo => (v ? "configurada" : "ausente");
  return [
    { nome: "OPENAI_API_KEY", estado: presente(chaveOpenAI()) },
    { nome: "ANTHROPIC_API_KEY", estado: presente(chaveAnthropic()) },
    { nome: "GEMINI_API_KEY", estado: presente(chaveGemini()) },
    { nome: "EVOLUTION_API_KEY", estado: forte("EVOLUTION_API_KEY") },
    { nome: "EVOLUTION_WEBHOOK_SECRET", estado: forte("EVOLUTION_WEBHOOK_SECRET") },
    { nome: "EVOLUTION_API_URL", estado: presente(process.env.EVOLUTION_API_URL?.trim()) },
    { nome: "EVOLUTION_INSTANCE", estado: presente(process.env.EVOLUTION_INSTANCE?.trim()) },
  ];
}
