/**
 * Google falso para testes: par RSA gerado na hora, `id_token` assinado em
 * RS256 (sem rede real).
 */

export const CLIENT_ID_TESTE = "cliente-teste.apps.googleusercontent.com";
export const KID_TESTE = "kid-teste";

export async function gerarChavesTeste() {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", par.publicKey)) as JsonWebKey;
  return { privada: par.privateKey, jwk: { ...jwk, kid: KID_TESTE, alg: "RS256", use: "sig" } };
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

export async function assinarIdToken(privada: CryptoKey, payload: Record<string, unknown>, cabecalho: Record<string, unknown> = { alg: "RS256", kid: KID_TESTE, typ: "JWT" }) {
  const dados = `${b64(cabecalho)}.${b64(payload)}`;
  const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privada, new TextEncoder().encode(dados));
  return `${dados}.${Buffer.from(assinatura).toString("base64url")}`;
}

export function claimsTeste(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const agora = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID_TESTE,
    azp: CLIENT_ID_TESTE,
    sub: "1000000000001",
    email: "ana@ij.test",
    email_verified: true,
    iat: agora,
    exp: agora + 3600,
    ...extra,
  };
}
