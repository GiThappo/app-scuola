// Legge la password dell'app da stdin e stampa l'hash per APP_PASSWORD_HASH (stesso formato di src/auth.ts).
// Uso: printf '%s' "$PASSWORD" | node scripts/hash-password.mjs | npx wrangler secret put APP_PASSWORD_HASH
import { webcrypto as crypto } from "node:crypto";

const ITERAZIONI = 100_000;
let pw = "";
for await (const pezzo of process.stdin) pw += pezzo;
pw = pw.replace(/\r?\n$/, "");
if (!pw) {
  console.error("Password vuota");
  process.exit(1);
}
const salt = crypto.getRandomValues(new Uint8Array(16));
const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERAZIONI }, chiave, 256);
const b64 = (b) => Buffer.from(b).toString("base64");
process.stdout.write(`pbkdf2$${ITERAZIONI}$${b64(salt)}$${b64(hash)}`);
