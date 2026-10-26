import { describe, expect, it } from "vitest";
import { ipDoCliente } from "./ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("ipDoCliente (último hop do X-Forwarded-For = o que o Caddy anexou)", () => {
  it("um IP só", () => {
    expect(ipDoCliente(h({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("XFF forjado pelo cliente com várias entradas: vale a ÚLTIMA, não a primeira", () => {
    expect(ipDoCliente(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(ipDoCliente(h({ "x-forwarded-for": "1.1.1.1,203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("trocar as entradas forjadas não muda a chave", () => {
    const a = ipDoCliente(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }));
    const b = ipDoCliente(h({ "x-forwarded-for": "8.8.8.8, 7.7.7.7, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("entradas vazias e espaços são ignorados", () => {
    expect(ipDoCliente(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7 , " }))).toBe("203.0.113.7");
  });

  it("sem XFF (dev, sem Caddy) → x-real-ip ou 'local'", () => {
    expect(ipDoCliente(h({ "x-real-ip": "10.0.0.2" }))).toBe("10.0.0.2");
    expect(ipDoCliente(h({}))).toBe("local");
  });

  it("valor absurdo é cortado (a chave do limitador não cresce sem limite)", () => {
    expect(ipDoCliente(h({ "x-forwarded-for": "x".repeat(500) })).length).toBeLessThanOrEqual(64);
  });
});
