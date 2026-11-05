import type { MiddlewareHandler } from "hono";

/** Intestazioni di sicurezza per ogni risposta. Le stesse sono in public/_headers per le pagine statiche (un test controlla). */
export const INTESTAZIONI: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Referrer-Policy": "no-referrer",
};

export const intestazioniSicurezza: MiddlewareHandler = async (c, next) => {
  await next();
  // Una rotta può avere la sua CSP (i file del materiale): le altre intestazioni valgono sempre
  for (const [k, v] of Object.entries(INTESTAZIONI)) if (!(k === "Content-Security-Policy" && c.res.headers.has(k))) c.res.headers.set(k, v);
};
