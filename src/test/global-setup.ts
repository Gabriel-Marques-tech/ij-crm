import { execSync } from "node:child_process";
import { urlDeTeste } from "./db";

/** Roda uma vez por execução do Vitest: migra o schema de teste. */
export default function setup() {
  const url = urlDeTeste();
  execSync("./node_modules/.bin/prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url;
}
