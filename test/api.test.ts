import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import orarioMd from "./fixtures/orario.md?raw";
import { creaApp } from "../src/api";
import { finto } from "./helpers/finto";
import type { Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: any };
const ORA = new Date("2026-10-23T14:00:00Z"); // venerdì
const COOKIE = { Cookie: "sessione=prova" };

const app = (now = ORA) => creaApp({ now: () => now, fetchFn: finto().fn });
const get = async (path: string, now = ORA) => {
  const r = await app(now).fetch(new Request(`https://app.test${path}`, { headers: COOKIE }), E);
  return { stato: r.status, json: (await r.json()) as any };
};
const voce = (id: number, data: string, materie: string[], tipo: string, scadenza: string | null, visto = "2026-10-01T00:00:00.000Z") =>
  E.DB.prepare("INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il) VALUES (?, ?, ?, ?, 'Prof. A', ?, ?, ?, ?)")
    .bind(id, data, JSON.stringify(materie), `testo ${id}`, tipo, scadenza, tipo === "COMPITO" ? 1 : 0, visto).run();
const voto = (id: number, materia: string, data: string, v: string, valore: number | null, visto = "2026-10-01T00:00:00.000Z") =>
  E.DB.prepare("INSERT INTO voti (id, materia, data, voto, valore, peso, tipo, periodo, nota, visto_il) VALUES (?, ?, ?, ?, ?, 1, 'Scritto', 1, '', ?)")
    .bind(id, materia, data, v, valore, visto).run();

beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  for (const t of ["voti", "agenda", "lezioni", "giorni", "periodi", "impostazioni", "sessioni"]) await E.DB.exec(`DELETE FROM ${t}`);
  await E.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('prova', '2099-01-01T00:00:00.000Z')").run();
  await E.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('orario_md', ?)").bind(orarioMd).run();
  await voce(1, "2026-10-23", ["Matematica"], "COMPITO", "2026-10-24", "2026-10-23T13:00:00.000Z");
  await voce(2, "2026-10-26", ["Italiano"], "VERIFICA", "2026-10-26");
  await voce(3, "2026-10-22", ["TPSIT"], "COMPITO", null);
  await voce(4, "2026-10-17", ["Matematica"], "VERIFICA", "2026-10-17");
  await voce(5, "2026-10-22", ["Informatica"], "VERIFICA", "2026-10-22");
  await voce(6, "2026-09-20", ["Inglese"], "COMPITO", null);
  await voce(7, "2026-05-20", ["Inglese"], "COMPITO", null);
  await voto(10, "Matematica", "2026-10-12", "7", 7);
  await voto(11, "TPSIT", "2026-10-17", "5", 5);
  await voto(12, "Informatica", "2026-10-23", "8", 8, "2026-10-23T12:00:00.000Z");
  await voto(13, "Italiano", "2026-10-10", "8", 8);
  await E.DB.prepare("INSERT INTO lezioni (id, data, ora, materia, argomento, tipo) VALUES (1, '2026-10-23', 3, 'Italiano', '', 'Lezione'), (2, '2026-10-23', 4, 'Italiano', '', 'Lezione')").run();
});

test("senza login: 401", async () => {
  const r = await app().fetch(new Request("https://app.test/api/agenda"), E);
  expect(r.status).toBe(401);
});

test("agenda", async () => {
  const { stato, json } = await get("/api/agenda");
  expect(stato).toBe(200);
  expect(json.giorni[0].data).toBe("2026-10-24");
  expect(json.giorni[0].voci[0]).toMatchObject({ id: 1, materie: ["Matematica"], tipo: "COMPITO", dedotta: true, nuova: true });
  const lun = json.giorni.find((g: any) => g.data === "2026-10-26");
  expect(lun.voci[0]).toMatchObject({ id: 2, tipo: "VERIFICA", nuova: false });
  expect(json.da_controllare.map((v: any) => v.id)).toEqual([3, 6]); // anche se vecchia di settimane
  expect(json.da_controllare.some((v: any) => v.id === 7)).toBe(false); // dell'anno scolastico scorso
  expect(json.giorni.flatMap((g: any) => g.voci).some((v: any) => v.id === 3)).toBe(false);
  // Matematica 17/10 senza voto dopo la verifica; Informatica 22/10 ha l'8 del 23
  expect(json.senza_voto).toEqual([{ materia: "Matematica", data: "2026-10-17", testo: "testo 4" }]);
  expect(json.promemoria).toEqual([]); // sabato non c'è Italiano
});

test("promemoria per le materie senza registro", async () => {
  const { json } = await get("/api/agenda", new Date("2026-10-25T10:00:00Z")); // domenica → lunedì c'è Italiano
  expect(json.promemoria).toEqual(["Italiano"]);
});

test("materie", async () => {
  const { json } = await get("/api/materie");
  const tpsit = json.find((m: any) => m.nome === "TPSIT");
  expect(tpsit).toEqual({ nome: "TPSIT", media: 5, n_voti: 1, sotto_sei: true });
  expect(json.map((m: any) => m.nome)).toEqual([...json.map((m: any) => m.nome)].sort((a: string, b: string) => a.localeCompare(b)));
});

test("una materia", async () => {
  const { stato, json } = await get("/api/materie/Italiano");
  expect(stato).toBe(200);
  expect(json.media).toBe(8);
  expect(json.voti[0]).toMatchObject({ voto: "8", nuovo: false });
  expect(json.in_arrivo.map((v: any) => v.id)).toEqual([2]);
  expect(json.lezioni).toEqual([{ data: "2026-10-23", ore: [3, 4], argomento: "" }]);
  expect((await get("/api/materie/Boh")).stato).toBe(404);
  expect((await get("/api/materie/Informatica")).json.voti[0].nuovo).toBe(true);
});

test("stato", async () => {
  const { json } = await get("/api/stato");
  expect(json).toEqual({ oggi: "2026-10-23", ultimo_ok: null, ultimo_tentativo: null, ultimo_errore: null });
});

test("aggiorna due volte di seguito", async () => {
  const a = app();
  const post = () => a.fetch(new Request("https://app.test/api/aggiorna", { method: "POST", headers: COOKIE }), E);
  const r1 = await post();
  expect(r1.status).toBe(200);
  expect(await r1.json()).toEqual({ ok: true });
  const r2 = await post();
  expect(r2.status).toBe(429);
  expect(await r2.json()).toEqual({ errore: "Aggiornamento appena fatto" });
});

test("aggiorna mentre un altro è in corso: 429", async () => {
  await E.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('in_corso', ?)").bind(new Date(ORA.getTime() - 10_000).toISOString()).run();
  const r = await app().fetch(new Request("https://app.test/api/aggiorna", { method: "POST", headers: COOKIE }), E);
  expect(r.status).toBe(429);
  expect(await r.json()).toEqual({ errore: "Aggiornamento già in corso" });
});

const invia = (metodo: string, path: string, body?: unknown) =>
  app().fetch(new Request(`https://app.test${path}`, { method: metodo, headers: { ...COOKIE, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), E);

test("aggiungi verifica a mano: compare in agenda come tua", async () => {
  const r = await invia("POST", "/api/agenda", { materia: "Italiano", data: "2026-10-28", testo: "Medioevo, pag. 10-40" });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as any;
  expect(id).toBeLessThan(0);
  const mer = (await get("/api/agenda")).json.giorni.find((g: any) => g.data === "2026-10-28");
  expect(mer.voci).toEqual([expect.objectContaining({ id, materie: ["Italiano"], tipo: "VERIFICA", testo: "Medioevo, pag. 10-40", tua: true, nuova: true })]);
  // la seconda prende un altro id negativo
  const r2 = await invia("POST", "/api/agenda", { materia: "Storia", data: "2026-10-29", testo: "" });
  expect(((await r2.json()) as any).id).toBeLessThan(id);
});

test("aggiungi verifica: materia e data servono, il passato no", async () => {
  expect((await invia("POST", "/api/agenda", { data: "2026-10-28", testo: "x" })).status).toBe(400);
  expect((await invia("POST", "/api/agenda", { materia: "Italiano", data: "28/10", testo: "x" })).status).toBe(400);
  expect((await invia("POST", "/api/agenda", { materia: "Italiano", data: "2026-10-22", testo: "x" })).status).toBe(400);
});

test("elimina verifica: solo quelle aggiunte a mano", async () => {
  const { id } = (await (await invia("POST", "/api/agenda", { materia: "Italiano", data: "2026-10-28", testo: "x" })).json()) as any;
  expect((await invia("DELETE", "/api/agenda/2")).status).toBe(404);
  expect((await invia("DELETE", `/api/agenda/${id}`)).status).toBe(200);
  const voci = (await get("/api/agenda")).json.giorni.flatMap((g: any) => g.voci);
  expect(voci.some((v: any) => v.id === id)).toBe(false);
  expect(voci.find((v: any) => v.id === 2).tua).toBe(false);
});

test("agenda dà le materie per il modulo", async () => {
  expect((await get("/api/agenda")).json.materie).toEqual(["Informatica", "Italiano", "Matematica", "TPSIT"]);
});
