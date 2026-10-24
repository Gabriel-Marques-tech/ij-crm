import "@testing-library/jest-dom/vitest";
import { urlDeTeste } from "./db";

// Qualquer módulo que importe `@/lib/db` dentro de um teste fala com o schema de teste.
process.env.DATABASE_URL = urlDeTeste();
