import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { applicaMigrazioni, MIGRAZIONI } from "../src/migrazioni";
import { creaApp } from "../src/api";
import type { Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: { name: string; queries: string[] }[] };
const db = E.DB;
const tabelle = async () => (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'").all<{ name: string }>()).results.map((r) => r.name).sort();

async function svuota() {
  for (const t of await tabelle()) await db.exec(`DROP TABLE IF EXISTS ${t}`);
  await db.exec("DROP TABLE IF EXISTS d1_migrations");
}

beforeEach(svuota);

test("ci sono tutte le migrazioni della cartella, in ordine", () => {
  expect(MIGRAZIONI.map((m) => m.nome)).toEqual(E.TEST_MIGRATIONS.map((m) => m.name));
});

test("database nuovo: crea le stesse tabelle e colonne di wrangler", async () => {
  await applyD1Migrations(db, E.TEST_MIGRATIONS);
  const schema = async () => (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name").all<{ name: string; sql: string | null }>()).results;
  const atteso = await schema();
  expect(atteso.length).toBeGreaterThan(10);
  await svuota();
  await applicaMigrazioni(db);
  expect(await schema()).toEqual(atteso);
  expect((await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>()).results.map((r) => r.name)).toEqual(MIGRAZIONI.map((m) => m.nome));
});

test("database già creato con wrangler: non rifà niente e non perde dati", async () => {
  await applyD1Migrations(db, E.TEST_MIGRATIONS);
  await db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('prova', 'resta')").run();
  await applicaMigrazioni(db);
  expect((await db.prepare("SELECT valore FROM impostazioni WHERE chiave = 'prova'").first<{ valore: string }>())!.valore).toBe("resta");
});

test("due volte, o insieme: va bene", async () => {
  await Promise.all([applicaMigrazioni(db), applicaMigrazioni(db)]);
  await applicaMigrazioni(db);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>())!.n).toBe(MIGRAZIONI.length);
});

test("una migrazione sbagliata non resta a metà e l'errore si vede", async () => {
  const rotta = { nome: "x.sql", sql: "CREATE TABLE t_prova (a);\nQUESTO NON È SQL;" };
  await expect(applicaMigrazioni(db, [rotta])).rejects.toThrow();
  expect(await tabelle()).not.toContain("t_prova");
  expect((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>())!.n).toBe(0);
});

test("primo avvio vero: il login funziona su un database vuoto", async () => {
  const r = await creaApp().fetch(new Request("https://app.test/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "sbagliata" }),
  }), { ...E, APP_PASSWORD_HASH: undefined, APP_PASSWORD: "giusta" } as Env);
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ errore: "Password sbagliata" });
});
