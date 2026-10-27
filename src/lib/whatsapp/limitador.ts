/**
 * Semáforo em memória, por processo: no máximo `concorrencia` tarefas ao
 * mesmo tempo e até `fila` esperando. Além disso `executar` devolve `null`
 * na hora (quem chama decide). Sem dependência nem serviço novo — uma
 * máquina, ≤ 15 usuários. Puro (só estado em memória).
 */
export type Limitador = {
  executar<T>(tarefa: () => Promise<T>): Promise<T> | null;
  estado(): { rodando: number; naFila: number };
};

export function criarLimitador(concorrencia: number, fila: number): Limitador {
  let rodando = 0;
  const espera: (() => void)[] = [];

  function liberar() {
    const proximo = espera.shift();
    if (proximo) proximo();
    else rodando--;
  }

  return {
    executar<T>(tarefa: () => Promise<T>): Promise<T> | null {
      if (rodando < concorrencia) {
        rodando++;
      } else if (espera.length < fila) {
        // A vaga é passada direto de quem termina para o próximo da fila.
        return new Promise<void>((r) => espera.push(r)).then(tarefa).finally(liberar);
      } else {
        return null;
      }
      return Promise.resolve().then(tarefa).finally(liberar);
    },
    estado: () => ({ rodando, naFila: espera.length }),
  };
}
