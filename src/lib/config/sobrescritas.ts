/**
 * Sobrescritas de variáveis de ambiente vindas da config técnica do Admin
 * (GAB-42). `env.ts` consulta isto ANTES de `process.env`, então toda leitura
 * existente (com as validações de lá) passa a seguir config > env > padrão.
 *
 * Só nomes da lista de `tecnica.ts` entram aqui — segredos e safe mode nunca.
 * Fica em `globalThis` porque route handlers e server actions podem ter
 * cópias distintas do módulo no bundle do Next, mas é um processo só.
 */
const g = globalThis as unknown as { __ijSobrescritasConfig?: Readonly<Record<string, string>> };

export function sobrescrita(nome: string): string | undefined {
  return g.__ijSobrescritasConfig?.[nome];
}

/** `undefined` = sem sobrescritas (só env). */
export function definirSobrescritas(mapa: Readonly<Record<string, string>> | undefined): void {
  g.__ijSobrescritasConfig = mapa;
}
