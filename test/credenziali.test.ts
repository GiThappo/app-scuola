import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { creaApp } from "../src/api";
import { aggiorna, type Env } from "../src/registro/aggiorna";
import { leggiCredenziali, salvaCredenziali } from "../src/registro/credenziali";
import { finto } from "./helpers/finto";

const BASE = env as unknown as Env & { TEST_MIGRATIONS: any };
const E = { ...BASE, APP_PASSWORD_HASH: undefined, APP_PASSWORD: "password dell'app" } as Env;
const SENZA = { ...E, CLASSEVIVA_UTENTE: undefined, CLASSEVIVA_PASSWORD: undefined } as Env;
const ORA = new Date("2026-10-23T14:00:00Z");
const RIFIUTO = { data: { auth: { loggedIn: false, errors: ["Identificativo o password errati"] } } };
const COOKIE = { Cookie: "sessione=prova", "Content-Type": "application/json" };

const impostazione = async (k: string) =>
  (await BASE.DB.prepare("SELECT valore FROM impostazioni WHERE chiave = ?").bind(k).first<{ valore: string | null }>())?.valore ?? null;
const chiama = async (metodo: string, percorso: string, corpo: unknown, ambiente: Env, fetchFn: typeof fetch, now = ORA) => {
  const r = await creaApp({ now: () => now, fetchFn }).fetch(new Request(`https://app.test${percorso}`, {
    method: metodo, headers: COOKIE, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }), ambiente);
  return { stato: r.status, testo: await r.text() };
};

beforeEach(async () => {
  await applyD1Migrations(BASE.DB, BASE.TEST_MIGRATIONS);
  for (const t of ["voti", "agenda", "lezioni", "giorni", "periodi", "impostazioni", "sessioni", "medie", "recap", "blocchi"]) await BASE.DB.exec(`DELETE FROM ${t}`);
  await BASE.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('prova', '2099-01-01T00:00:00.000Z')").run();
});

test("le credenziali salvate sono cifrate e valgono più dei segreti", async () => {
  await salvaCredenziali(E, "S1234567X", "segreta-di-prova");
  const salvate = await impostazione("classeviva_cifrate");
  expect(salvate).toBeTruthy();
  expect(salvate).not.toContain("S1234567X");
  expect(salvate).not.toContain("segreta-di-prova");
  expect(await leggiCredenziali(E)).toEqual({ utente: "S1234567X", password: "segreta-di-prova" });
});

test("senza credenziali salvate usa i segreti; senza niente non ce ne sono", async () => {
  expect(await leggiCredenziali(E)).toEqual({ utente: BASE.CLASSEVIVA_UTENTE, password: BASE.CLASSEVIVA_PASSWORD });
  expect(await leggiCredenziali(SENZA)).toBeNull();
});

test("con una chiave diversa non si decifrano: si torna ai segreti", async () => {
  await salvaCredenziali(E, "S1234567X", "segreta-di-prova");
  expect(await leggiCredenziali({ ...SENZA, APP_PASSWORD: "altra" })).toBeNull();
  expect(await leggiCredenziali({ ...E, APP_PASSWORD: "altra" })).toEqual({ utente: BASE.CLASSEVIVA_UTENTE, password: BASE.CLASSEVIVA_PASSWORD });
});

test("senza credenziali non contatta Classeviva e lo dice", async () => {
  const f = finto();
  const r = await aggiorna(SENZA, ORA, f.fn);
  expect(r.ok).toBe(false);
  expect(r.errore).toContain("Collega Classeviva");
  expect(f.richieste).toEqual([]);
});

test("password rifiutata: non riprova da solo finché non la correggi", async () => {
  const rifiuto = finto({ login: RIFIUTO });
  expect((await aggiorna(E, ORA, rifiuto.fn)).errore).toBe("Identificativo o password errati");
  const dopoPrimo = rifiuto.richieste.length;
  expect(dopoPrimo).toBeGreaterThan(0);

  const r = await aggiorna(E, new Date(ORA.getTime() + 3600_000), rifiuto.fn); // il cron dell'ora dopo
  expect(r).toEqual({ ok: false, errore: "Identificativo o password errati" });
  expect(rifiuto.richieste.length).toBe(dopoPrimo);

  const buono = finto();
  expect((await aggiorna(E, new Date(ORA.getTime() + 7200_000), buono.fn, { forza: true })).ok).toBe(true); // tasto Aggiorna
  expect(await impostazione("credenziali_rifiutate")).toBeNull();
});

test("Classeviva giù: messaggio comprensibile, nessun codice tecnico, e riprova da solo", async () => {
  const giu = finto({ stato: () => 503 });
  const r = await aggiorna(E, ORA, giu.fn);
  expect(r.errore).toBe("Classeviva non risponde come dovrebbe. Riprovo da solo più tardi");
  expect(r.errore).not.toContain("HTTP");
  expect(await impostazione("credenziali_rifiutate")).toBeNull();
  const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  expect((await aggiorna(E, new Date(ORA.getTime() + 3600_000), offline)).errore).toBe("Non riesco a collegarmi a Classeviva. Riprovo da solo più tardi");
});

test("/api/stato dice se Classeviva va collegato o corretto, senza segreti", async () => {
  const stato = async (a: Env) => JSON.parse((await chiama("GET", "/api/stato", undefined, a, finto().fn)).testo);
  expect((await stato(SENZA)).classeviva).toBe("mancante");
  expect((await stato(E)).classeviva).toBe("ok");
  expect((await stato(E)).ha_orario).toBe(false);
  await aggiorna(E, ORA, finto({ login: RIFIUTO }).fn);
  const s = await stato(E);
  expect(s.classeviva).toBe("rifiutata");
  expect(JSON.stringify(s)).not.toContain(BASE.CLASSEVIVA_PASSWORD);
});

test("collegare Classeviva dall'app: prova l'accesso, salva e scarica il registro", async () => {
  const f = finto();
  const r = await chiama("POST", "/api/classeviva", { utente: " S1234567X ", password: "segreta-di-prova" }, SENZA, f.fn);
  expect(r.stato).toBe(200);
  expect(JSON.parse(r.testo)).toEqual({ ok: true, aggiornato: true });
  expect(r.testo).not.toContain("segreta-di-prova");
  expect(await leggiCredenziali(SENZA)).toEqual({ utente: "S1234567X", password: "segreta-di-prova" });
  expect(await impostazione("ultimo_ok")).toBeTruthy();
  expect(String(f.richieste.find((x) => x.url.includes("AuthApi4"))?.init?.body)).toContain("uid=S1234567X");
});

test("collegare Classeviva: una password rifiutata non viene salvata", async () => {
  const r = await chiama("POST", "/api/classeviva", { utente: "S1", password: "sbagliata" }, SENZA, finto({ login: RIFIUTO }).fn);
  expect(r.stato).toBe(400);
  expect(JSON.parse(r.testo).errore).toBe("Identificativo o password errati");
  expect(await impostazione("classeviva_cifrate")).toBeNull();
});

test("collegare Classeviva: se il sito è giù non dà la colpa alla password", async () => {
  const r = await chiama("POST", "/api/classeviva", { utente: "S1", password: "giusta" }, SENZA, finto({ stato: () => 503 }).fn);
  expect(r.stato).toBe(502);
  expect(JSON.parse(r.testo).errore).toContain("Classeviva non risponde");
  expect(await impostazione("classeviva_cifrate")).toBeNull();
});

test("collegare Classeviva: dati incompleti e troppi tentativi ravvicinati", async () => {
  for (const corpo of [undefined, {}, { utente: "S1" }, { utente: "", password: "x" }, { utente: 1, password: 2 }, { utente: "x".repeat(101), password: "x" }]) {
    expect((await chiama("POST", "/api/classeviva", corpo, SENZA, finto().fn)).stato).toBe(400);
  }
  const f = finto({ login: RIFIUTO });
  expect((await chiama("POST", "/api/classeviva", { utente: "S1", password: "a" }, SENZA, f.fn)).stato).toBe(400);
  const secondo = await chiama("POST", "/api/classeviva", { utente: "S1", password: "b" }, SENZA, f.fn, new Date(ORA.getTime() + 5000));
  expect(secondo.stato).toBe(429);
  expect(f.richieste.filter((x) => x.url.includes("AuthApi4")).length).toBe(1);
});
