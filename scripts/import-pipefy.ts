/** Import do Pipefy pelo terminal (go-live). Ver `src/lib/importacao/pipefy/cli.ts`. */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { registrarErro } from "../src/lib/erros/registrar";
import { rodarCli } from "../src/lib/importacao/pipefy/cli";

rodarCli(process.argv.slice(2), {
  log: (m) => console.log(m),
  erro: (m) => console.error(m),
  ler: (c) => readFileSync(c),
  escrever: (c, s) => writeFileSync(c, s),
  env: process.env,
})
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((e) => {
    // Detalhe (sem dados da query) vai para o log com a ref; na tela, só a ref.
    console.error(`Erro inesperado (ref: ${registrarErro("cli.import.pipefy", e)}).`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
