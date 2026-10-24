#!/usr/bin/env node
// Carica nell'app il materiale di studio e i recap del giorno scritti dal tutor sul PC.
//
//   node scripts/carica-materiale.mjs [cartella]       (cartella di default: ~/Scuola)
//   node scripts/carica-materiale.mjs --prova          fa vedere cosa farebbe, senza cambiare niente
//
// Dalla cartella prende:
//   materiale/<Materia>/{schede,fonti,appunti}/*  (pdf, md, txt, png, jpg, webp) → in Materie, nella pagina della materia
//   report/AAAA-MM-GG.txt                         → nella scheda Recap
// Carica solo i file nuovi o cambiati e toglie dall'app quelli che non ci sono più sul PC.
//
// Indirizzo dell'app: APP_URL (variabile o riga APP_URL=... in <cartella>/app.env).
// Password dell'app: APP_PASSWORD, altrimenti il file .password-app nella cartella dell'app, altrimenti la chiede.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const TIPI = ["schede", "fonti", "appunti"];
const ESTENSIONI = /\.(pdf|md|txt|png|jpe?g|webp)$/i;
const RECAP_DA_RICARICARE = 3; // gli ultimi report si riscrivono durante la giornata

const argomenti = process.argv.slice(2);
const prova = argomenti.includes("--prova");
const cartella = argomenti.find((a) => !a.startsWith("--")) ?? join(homedir(), "Scuola");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function leggiEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n")
    .map((r) => r.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, "$2")]));
}

async function chiediPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  const file = join(repo, ".password-app");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("Password dell'app: ");
  rl.close();
  return pw;
}

const sha256 = (dati) => createHash("sha256").update(dati).digest("hex");
const urlFile = (percorso) => `/api/file/${percorso.split("/").map(encodeURIComponent).join("/")}`;

function fileLocali() {
  const base = join(cartella, "materiale");
  if (!existsSync(base)) return [];
  const trovati = [];
  for (const materia of readdirSync(base).filter((m) => !m.startsWith(".") && statSync(join(base, m)).isDirectory())) {
    for (const tipo of TIPI.filter((t) => existsSync(join(base, materia, t)))) {
      for (const nome of readdirSync(join(base, materia, tipo)).filter((n) => !n.startsWith(".") && ESTENSIONI.test(n))) {
        const completo = join(base, materia, tipo, nome);
        if (statSync(completo).isFile()) trovati.push({ percorso: `${materia}/${tipo}/${nome}`, completo });
      }
    }
  }
  return trovati;
}

function recapLocali() {
  const base = join(cartella, "report");
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(n)).sort()
    .map((n) => ({ data: basename(n, ".txt"), completo: join(base, n) }));
}

const appUrl = (process.env.APP_URL ?? leggiEnv(join(cartella, "app.env")).APP_URL ?? "").replace(/\/$/, "");
if (!appUrl) {
  console.error(`Manca l'indirizzo dell'app: metti APP_URL=https://... in ${join(cartella, "app.env")}`);
  process.exit(1);
}

let cookie = "";
async function chiama(metodo, percorso, corpo) {
  const r = await fetch(appUrl + percorso, { method: metodo, body: corpo, headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`${metodo} ${decodeURIComponent(percorso)}: ${r.status} ${(await r.json().catch(() => ({}))).errore ?? ""}`.trim());
  return r;
}

const login = await fetch(`${appUrl}/api/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: await chiediPassword() }),
});
if (!login.ok) {
  console.error(`Login nell'app non riuscito: ${(await login.json().catch(() => ({}))).errore ?? login.status}`);
  process.exit(1);
}
cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const fatto = { caricati: 0, uguali: 0, tolti: 0, recap: 0, errori: 0 };
const azione = async (descrizione, fn) => {
  console.log(`${prova ? "[prova] " : ""}${descrizione}`);
  if (prova) return true;
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    fatto.errori++;
    return false;
  }
};

const online = new Map((await (await chiama("GET", "/api/file")).json()).map((f) => [f.percorso, f.sha256]));
const locali = fileLocali();
for (const { percorso, completo } of locali) {
  const dati = readFileSync(completo);
  if (online.get(percorso) === sha256(dati)) {
    fatto.uguali++;
    continue;
  }
  if (await azione(`↑ ${percorso}`, () => chiama("PUT", urlFile(percorso), dati))) fatto.caricati++;
}
for (const percorso of online.keys()) {
  if (locali.some((f) => f.percorso === percorso)) continue;
  if (await azione(`✗ ${percorso} (non c'è più sul PC)`, () => chiama("DELETE", urlFile(percorso)))) fatto.tolti++;
}

const recapOnline = new Set((await (await chiama("GET", "/api/recap")).json()).map((r) => r.data));
const recap = recapLocali();
for (const [i, { data, completo }] of recap.entries()) {
  if (recapOnline.has(data) && i < recap.length - RECAP_DA_RICARICARE) continue;
  if (await azione(`↑ recap ${data}`, () => chiama("PUT", `/api/recap/${data}`, readFileSync(completo, "utf8")))) fatto.recap++;
}

console.log(`\nMateriale: ${fatto.caricati} caricati, ${fatto.uguali} già aggiornati, ${fatto.tolti} tolti. Recap caricati: ${fatto.recap}.` +
  (fatto.errori ? ` Errori: ${fatto.errori}.` : ""));
process.exit(fatto.errori ? 1 : 0);
