import type { Env } from "./aggiorna";

type Credenziali = { utente: string; password: string };

const CHIAVE_DB = "classeviva_cifrate";
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const daB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** La chiave nasce dal segreto dell'app, che sta su Cloudflare e non nel database: una copia del database non basta a leggerle. */
async function chiave(env: Env): Promise<CryptoKey | null> {
  const segreto = env.APP_PASSWORD_HASH || env.APP_PASSWORD;
  if (!segreto) return null;
  const grezza = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`app-scuola-classeviva:${segreto}`));
  return crypto.subtle.importKey("raw", grezza, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function salvaCredenziali(env: Env, utente: string, password: string): Promise<void> {
  const k = await chiave(env);
  if (!k) throw new Error("Manca il segreto dell'app");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrato = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify({ utente, password })));
  await env.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore")
    .bind(CHIAVE_DB, `v1.${b64(iv)}.${b64(cifrato)}`).run();
}

/** Prima quelle salvate dall'app, poi i segreti di Cloudflare. Null se non ce ne sono: mai un'eccezione. */
export async function leggiCredenziali(env: Env): Promise<Credenziali | null> {
  const salvate = (await env.DB.prepare("SELECT valore FROM impostazioni WHERE chiave = ?").bind(CHIAVE_DB).first<{ valore: string | null }>())?.valore;
  const k = salvate ? await chiave(env) : null;
  if (salvate && k) {
    try {
      const [, iv, dati] = salvate.split(".");
      const chiaro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: daB64(iv) }, k, daB64(dati));
      return JSON.parse(new TextDecoder().decode(chiaro)) as Credenziali;
    } catch {
      // Il segreto dell'app è cambiato: quelle salvate non si leggono più e vanno inserite di nuovo
    }
  }
  return env.CLASSEVIVA_UTENTE && env.CLASSEVIVA_PASSWORD ? { utente: env.CLASSEVIVA_UTENTE, password: env.CLASSEVIVA_PASSWORD } : null;
}
