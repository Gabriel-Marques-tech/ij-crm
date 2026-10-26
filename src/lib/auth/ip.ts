/**
 * IP do cliente para os limitadores de tentativa (login e "esqueci a senha").
 *
 * DEPENDE DO CADDY (Caddyfile, `reverse_proxy app:3000`): em produção ele é a
 * única coisa na frente do app (compose.prod só publica o Caddy) e ANEXA o IP
 * de quem conectou ao fim do `X-Forwarded-For`. As entradas anteriores vêm do
 * cliente e podem ser forjadas à vontade, por isso vale a ÚLTIMA. Se algum dia
 * houver outro proxy/CDN na frente do Caddy, isto passa a ver o IP desse proxy
 * (todo mundo cai na mesma chave): configure `trusted_proxies` no Caddy e
 * revise esta função. Ver docs/runbook.md ("IP do cliente e limitadores").
 *
 * Sem `X-Forwarded-For` (dev, sem Caddy): `x-real-ip` ou "local".
 */
const IP_MAX = 64;

export function ipDoCliente(h: Pick<Headers, "get">): string {
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = hops.at(-1) || h.get("x-real-ip")?.trim() || "local";
  return ip.slice(0, IP_MAX);
}
