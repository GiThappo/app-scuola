import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./registro/aggiorna";

const ITERAZIONI = 100_000;
const DURATA_SESSIONE = 90 * 24 * 3600; // secondi
const MAX_TENTATIVI = 5; // sbagliati al minuto

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const daB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriva(pw: string, salt: Uint8Array, iterazioni: number): Promise<ArrayBuffer> {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iterazioni }, chiave, 256);
}

/** Formato: pbkdf2$<iterazioni>$<salt b64>$<hash b64> */
export async function hashPassword(pw: string, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  return `pbkdf2$${ITERAZIONI}$${b64(salt)}$${b64(await deriva(pw, salt, ITERAZIONI))}`;
}

export async function verificaPassword(pw: string, hash: string): Promise<boolean> {
  const [tipo, iter, salt, atteso] = hash.split("$");
  if (tipo !== "pbkdf2" || !salt || !atteso) return false;
  const calcolato = new Uint8Array(await deriva(pw, daB64(salt), Number(iter)));
  const giusto = daB64(atteso);
  if (calcolato.length !== giusto.length) return false;
  let diff = 0;
  for (let i = 0; i < giusto.length; i++) diff |= calcolato[i] ^ giusto[i];
  return diff === 0;
}

const nuovoToken = () =>
  b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export const richiediLogin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = getCookie(c, "sessione");
  const ok = token
    ? await c.env.DB.prepare("SELECT 1 FROM sessioni WHERE token = ? AND scade > ?").bind(token, new Date().toISOString()).first()
    : null;
  if (!ok) return c.json({ errore: "login richiesto" }, 401);
  await next();
};

export const rotteAuth = new Hono<{ Bindings: Env }>();

rotteAuth.post("/api/login", async (c) => {
  const db = c.env.DB;
  const minuto = new Date().toISOString().slice(0, 16);
  const tentativi = await db.prepare("SELECT n FROM tentativi_login WHERE minuto = ?").bind(minuto).first<{ n: number }>();
  if ((tentativi?.n ?? 0) >= MAX_TENTATIVI) return c.json({ errore: "Troppi tentativi, riprova tra un minuto" }, 429);

  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!password || !(await verificaPassword(password, c.env.APP_PASSWORD_HASH))) {
    await db.batch([
      db.prepare("INSERT INTO tentativi_login (minuto, n) VALUES (?, 1) ON CONFLICT(minuto) DO UPDATE SET n = n + 1").bind(minuto),
      db.prepare("DELETE FROM tentativi_login WHERE minuto < ?").bind(minuto),
    ]);
    return c.json({ errore: "Password sbagliata" }, 401);
  }

  const token = nuovoToken();
  const ora = new Date();
  await db.batch([
    db.prepare("INSERT INTO sessioni (token, scade) VALUES (?, ?)").bind(token, new Date(ora.getTime() + DURATA_SESSIONE * 1000).toISOString()),
    db.prepare("DELETE FROM sessioni WHERE scade < ?").bind(ora.toISOString()),
  ]);
  setCookie(c, "sessione", token, { httpOnly: true, secure: true, sameSite: "Strict", maxAge: DURATA_SESSIONE, path: "/" });
  return c.json({ ok: true });
});

rotteAuth.post("/api/logout", async (c) => {
  const token = getCookie(c, "sessione");
  if (token) await c.env.DB.prepare("DELETE FROM sessioni WHERE token = ?").bind(token).run();
  deleteCookie(c, "sessione", { path: "/", secure: true });
  return c.json({ ok: true });
});
