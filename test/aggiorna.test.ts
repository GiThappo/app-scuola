import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import orarioMd from "./fixtures/orario.md?raw";
import grades from "./fixtures/grades.json";
import agenda from "./fixtures/agenda.json";
import { finto } from "./helpers/finto";
import { aggiorna, type Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: any };
const ORA = new Date("2026-10-23T14:00:00Z");
const DOPO = new Date("2026-10-23T15:00:00Z");
const righe = async (sql: string) => (await E.DB.prepare(sql).all<any>()).results;
const impostazione = async (k: string) =>
  (await E.DB.prepare("SELECT valore FROM impostazioni WHERE chiave = ?").bind(k).first<{ valore: string }>())?.valore ?? null;

beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  for (const t of ["voti", "agenda", "lezioni", "giorni", "periodi", "impostazioni"]) await E.DB.exec(`DELETE FROM ${t}`);
  await E.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('orario_md', ?)").bind(orarioMd).run();
});

test("aggiornamento riuscito", async () => {
  expect(await aggiorna(E, ORA, finto().fn)).toEqual({ ok: true });
  const voti = await righe("SELECT * FROM voti");
  expect(voti.length).toBe(grades.grades.length);
  expect(voti.map((v) => v.materia)).toContain("TPSIT");
  const ag = await righe("SELECT * FROM agenda ORDER BY data");
  expect(ag.length).toBe(agenda.agenda.length);
  expect(ag.some((v) => v.dedotta === 1 && v.scadenza)).toBe(true);
  expect(ag.find((v) => /verifica scritta di matematica/i.test(v.testo)).tipo).toBe("VERIFICA");
  expect(await impostazione("ultimo_ok")).toBe(ORA.toISOString());
  expect(await impostazione("ultimo_errore")).toBeFalsy();
  expect((await righe("SELECT * FROM giorni")).length).toBeGreaterThan(0);
  expect((await righe("SELECT * FROM lezioni")).length).toBeGreaterThan(0);
});

test("visto_il resta quello della prima volta", async () => {
  await aggiorna(E, ORA, finto().fn);
  await aggiorna(E, DOPO, finto().fn);
  const voti = await righe("SELECT DISTINCT visto_il FROM voti");
  expect(voti).toEqual([{ visto_il: ORA.toISOString() }]);
  const ag = await righe("SELECT DISTINCT visto_il FROM agenda");
  expect(ag).toEqual([{ visto_il: ORA.toISOString() }]);
});

test("niente voci di sostegno o supplenza", async () => {
  const extra = { ...agenda.agenda[0], evtId: 999, subjectDesc: "SOSTEGNO", notes: "attività" };
  await aggiorna(E, ORA, finto({ agenda: [...agenda.agenda, extra] }).fn);
  expect(await righe("SELECT * FROM agenda WHERE id = 999")).toEqual([]);
});

test("voci sparite: tolte nel periodo scaricato, tenute fuori", async () => {
  await E.DB.prepare("INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il) VALUES (1, '2026-09-01', '[]', 'vecchia', 'x', 'COMPITO', NULL, 0, 'x')").run();
  await aggiorna(E, ORA, finto().fn);
  const tolta = agenda.agenda[0];
  await aggiorna(E, DOPO, finto({ agenda: agenda.agenda.slice(1) }).fn);
  expect(await righe(`SELECT id FROM agenda WHERE id = ${tolta.evtId}`)).toEqual([]);
  expect(await righe("SELECT id FROM agenda WHERE id = 1")).toEqual([{ id: 1 }]);
});

test("voci aggiunte a mano (id negativo): restano anche se Classeviva non le ha", async () => {
  await E.DB.prepare("INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il) VALUES (-1, '2026-10-23', '[\"Italiano\"]', 'Verifica', 'a mano', 'VERIFICA', '2026-10-26', 0, 'x')").run();
  await aggiorna(E, ORA, finto().fn);
  expect(await righe("SELECT id FROM agenda WHERE id = -1")).toEqual([{ id: -1 }]);
});

test("aggiorna mantiene i dati se il login fallisce", async () => {
  await aggiorna(E, ORA, finto().fn);
  const prima = { voti: await righe("SELECT * FROM voti ORDER BY id"), agenda: await righe("SELECT * FROM agenda ORDER BY id") };
  const r = await aggiorna(E, DOPO, finto({ login: { data: { auth: { loggedIn: false, errors: ["Identificativo o password errati"] } } } }).fn);
  expect(r).toEqual({ ok: false, errore: "Identificativo o password errati" });
  expect(await righe("SELECT * FROM voti ORDER BY id")).toEqual(prima.voti);
  expect(await righe("SELECT * FROM agenda ORDER BY id")).toEqual(prima.agenda);
  expect(await impostazione("ultimo_ok")).toBe(ORA.toISOString());
  expect(await impostazione("ultimo_errore")).toBe("Identificativo o password errati");
  expect(await impostazione("ultimo_tentativo")).toBe(DOPO.toISOString());
});

test("errore riuscito dopo un errore: l'errore si cancella", async () => {
  await aggiorna(E, ORA, finto({ stato: () => 403 }).fn);
  expect(await impostazione("ultimo_errore")).toBeTruthy();
  await aggiorna(E, DOPO, finto().fn);
  expect(await impostazione("ultimo_errore")).toBeFalsy();
});

test("senza orario: riesce, compiti senza scadenza", async () => {
  await E.DB.exec("DELETE FROM impostazioni");
  expect(await aggiorna(E, ORA, finto().fn)).toEqual({ ok: true });
  const compiti = await righe("SELECT scadenza FROM agenda WHERE tipo = 'COMPITO'");
  expect(compiti.length).toBeGreaterThan(0);
  expect(compiti.every((c) => c.scadenza === null)).toBe(true);
});

test("compito già scaduto: la scadenza resta la lezione passata, non la prossima", async () => {
  // Domenica 25: il calendario di Classeviva parte da oggi, ma il compito del 22 era per venerdì 23
  const domenica = new Date("2026-10-25T10:00:00Z");
  const calendario = (await import("./fixtures/calendar.json")).calendar.filter((c: any) => c.dayDate >= "2026-10-25");
  await aggiorna(E, domenica, finto({ calendario }).fn);
  const v = await E.DB.prepare("SELECT scadenza FROM agenda WHERE id = 3000331").first<{ scadenza: string }>();
  expect(v?.scadenza).toBe("2026-10-23");
});

test("risposta 200 senza i dati: non cancella i voti", async () => {
  await aggiorna(E, ORA, finto().fn);
  const prima = await righe("SELECT * FROM voti ORDER BY id");
  const r = await aggiorna(E, DOPO, finto({ corpi: [["/grades", { errore: "boh" }]] }).fn);
  expect(r.ok).toBe(false);
  expect(await righe("SELECT * FROM voti ORDER BY id")).toEqual(prima);
  expect((await righe("SELECT * FROM periodi")).length).toBeGreaterThan(0);
});

test("due aggiornamenti insieme: ne parte uno solo", async () => {
  const f = finto();
  const [a, b] = await Promise.all([aggiorna(E, ORA, f.fn), aggiorna(E, ORA, f.fn)]);
  expect([a, b].filter((r) => r.ok)).toHaveLength(1);
  expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, inCorso: true, errore: "Aggiornamento già in corso" });
  expect(f.richieste.filter((r) => r.url.includes("AuthApi4"))).toHaveLength(1);
  expect(await impostazione("ultimo_errore")).toBeFalsy();
});

test("un aggiornamento bloccato da più di 2 minuti non blocca i successivi", async () => {
  await E.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('in_corso', '2026-10-23T13:57:00.000Z')").run();
  expect(await aggiorna(E, ORA, finto().fn)).toEqual({ ok: true });
  expect(await impostazione("in_corso")).toBeNull();
});
