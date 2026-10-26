/** Import do Pipefy pelo terminal (go-live). Ver `src/lib/importacao/pipefy/cli.ts`. */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
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
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
