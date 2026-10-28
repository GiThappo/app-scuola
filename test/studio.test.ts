import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import orarioMd from "./fixtures/orario.md?raw";
import { creaApp } from "../src/api";
import { finto } from "./helpers/finto";
import type { Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: any };
const ORA = new Date("2026-10-23T14:00:00Z"); // venerdì 16:00 a Roma
const COOKIE = { Cookie: "sessione=prova" };
const TOKEN = { Authorization: "Bearer token-di-test" };

const chiama = async (metodo: string, path: string, corpo?: unknown, headers: Record<string, string> = COOKIE, e: Env = E, now = ORA) => {
  const r = await creaApp({ now: () => now, fetchFn: finto().fn }).fetch(new Request(`https://app.test${path}`, {
    method: metodo, headers: { ...headers, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }), e);
  return { stato: r.status, json: (await r.json()) as any };
};
const sync = (corpo: unknown = {}, now = ORA) => chiama("POST", "/cal/sync", corpo, TOKEN, E, now);
const studio = async () => (await chiama("GET", "/api/studio")).json;
const blocchi = async () => (await studio()).giorni.flatMap((g: any) => g.blocchi);
const voce = (id: number, materia: string, tipo: string, scadenza: string) =>
  E.DB.prepare("INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il) VALUES (?, ?, ?, ?, 'Prof. A', ?, ?, 0, '2026-10-01T00:00:00.000Z')")
    .bind(id, scadenza, JSON.stringify([materia]), `testo ${id}`, tipo, scadenza).run();

beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  for (const t of ["voti", "agenda", "lezioni", "giorni", "periodi", "impostazioni", "sessioni", "blocchi", "impegni"]) await E.DB.exec(`DELETE FROM ${t}`);
  await E.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('prova', '2099-01-01T00:00:00.000Z')").run();
  await E.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('orario_md', ?)").bind(orarioMd).run();
  await voce(1, "Matematica", "COMPITO", "2026-10-27"); // mar → lun 26
  await voce(2, "Storia", "VERIFICA", "2026-10-31"); // sab → mar..ven
});

test("sync: token obbligatorio, e senza token configurato 503", async () => {
  expect((await chiama("POST", "/cal/sync", {}, { Authorization: "Bearer sbagliato" })).stato).toBe(401);
  expect((await chiama("POST", "/cal/sync", {}, COOKIE)).stato).toBe(401);
  expect((await chiama("POST", "/cal/sync", {}, TOKEN, { ...E, CALENDARIO_TOKEN: undefined })).stato).toBe(503);
});

test("sync: il piano evita gli impegni e torna allo script con gli orari in UTC", async () => {
  // lun 26 dalle 15:00 alle 17:00 a Roma (UTC+1 dopo il cambio d'ora)
  const r = await sync({ impegni: [{ id: "x", titolo: "Calcetto", inizio: "2026-10-26T14:00:00.000Z", fine: "2026-10-26T16:00:00.000Z" }] });
  expect(r.stato).toBe(200);
  const compito = r.json.blocchi.find((b: any) => b.titolo === "[Tutor] Matematica: Compito per mar 27");
  expect(compito).toMatchObject({ inizio: "2026-10-26T16:00:00.000Z", fine: "2026-10-26T16:45:00.000Z", versione: 1 });
  expect(compito.descrizione).toContain("testo 1");
  expect(r.json.prove).toEqual([{ id: "p2", data: "2026-10-31", titolo: "[Tutor] VERIFICA Storia", descrizione: "testo 2" }]);
  expect(r.json.da).toBe("2026-10-15T22:00:00.000Z");

  const s = await studio();
  expect(s.calendario.ultimo_sync).toBe(ORA.toISOString());
  const lun = s.giorni.find((g: any) => g.data === "2026-10-26");
  expect(lun.blocchi.map((b: any) => `${b.ora}-${b.fine} ${b.materia}`)).toEqual(["17:00-17:45 Matematica"]);
});

test("sync ripetuta: niente cambia, le versioni restano", async () => {
  const a = await sync();
  const b = await sync();
  expect(b.json.blocchi).toEqual(a.json.blocchi);
});

test("spostare un blocco dall'app: diventa tuo e il resto si sposta intorno", async () => {
  await sync();
  // martedì è pesante: la prima sessione di Storia è in due pezzi, 16:00 e 16:40
  const mar = () => blocchi().then((t) => t.filter((b: any) => b.data === "2026-10-27").map((b: any) => `${b.ora} ${b.durata} ${b.tuo}`));
  expect(await mar()).toEqual(["16:00 30 false", "16:40 30 false"]);
  const primo = (await blocchi()).find((b: any) => b.data === "2026-10-27");
  expect((await chiama("PATCH", `/api/studio/${primo.id}`, { ora: "16:30" })).stato).toBe(200);
  expect(await mar()).toEqual(["16:00 30 false", "16:30 30 true"]); // l'altro pezzo resta e va prima
  expect((await sync()).json.blocchi.find((b: any) => b.id === `b${primo.id}`).versione).toBe(2);
});

test("spostato su un altro giorno: la sessione non si rifà", async () => {
  await sync();
  const b = (await blocchi()).find((b: any) => b.data === "2026-10-28" && b.materia === "Storia");
  await chiama("PATCH", `/api/studio/${b.id}`, { data: "2026-10-24", ora: "18:00", durata: 30 });
  const storia = (await blocchi()).filter((x: any) => x.materia === "Storia");
  expect(storia.filter((x: any) => x.data === "2026-10-28")).toEqual([]);
  expect(storia.find((x: any) => x.id === b.id)).toMatchObject({ data: "2026-10-24", ora: "18:00", fine: "18:30", tuo: true });
});

test("fatto e eliminato", async () => {
  await sync();
  const [primo, secondo] = await blocchi();
  await chiama("PATCH", `/api/studio/${primo.id}`, { fatto: true });
  await chiama("DELETE", `/api/studio/${secondo.id}`);
  const ora = await blocchi();
  expect(ora.find((b: any) => b.id === primo.id)).toMatchObject({ fatto: true, tuo: false });
  expect(ora.some((b: any) => b.id === secondo.id)).toBe(false);
  await sync();
  expect((await blocchi()).length).toBe(ora.length); // l'eliminato non torna
  expect((await sync()).json.blocchi.find((b: any) => b.id === `b${primo.id}`).titolo).toMatch(/^✓ \[Tutor\]/);
});

test("aggiungere un blocco a mano", async () => {
  expect((await chiama("POST", "/api/studio", { materia: "Inglese", cosa: "Verbi", data: "2026-10-24", ora: "25:00", durata: 30 })).stato).toBe(400);
  const r = await chiama("POST", "/api/studio", { materia: "Inglese", cosa: "Verbi irregolari", data: "2026-10-24", ora: "15:00", durata: 30 });
  expect(r.stato).toBe(201);
  const sab = (await blocchi()).filter((b: any) => b.data === "2026-10-24");
  expect(sab[0]).toMatchObject({ materia: "Inglese", cosa: "Verbi irregolari", ora: "15:00", tuo: true });
  await chiama("DELETE", `/api/studio/${r.json.id}`);
  expect((await blocchi()).some((b: any) => b.id === r.json.id)).toBe(false);
  expect((await studio()).eliminati.map((b: any) => b.id)).toEqual([r.json.id]);
});

test("spostato o cancellato dentro Calendar", async () => {
  const { json } = await sync();
  const [a, b] = json.blocchi;
  await sync({ spostati: [{ id: a.id, inizio: "2026-10-24T16:00:00.000Z", fine: "2026-10-24T16:20:00.000Z" }], eliminati: [b.id] });
  const tutti = await blocchi();
  expect(tutti.find((x: any) => `b${x.id}` === a.id)).toMatchObject({ data: "2026-10-24", ora: "18:00", durata: 20, tuo: true });
  expect(tutti.some((x: any) => `b${x.id}` === b.id)).toBe(false);
});

test("se il tempo non basta lo dice", async () => {
  const giorno = (g: string) => ({ id: g, titolo: "Gita", inizio: `${g}T05:00:00.000Z`, fine: `${g}T21:00:00.000Z` });
  await sync({ impegni: ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map(giorno) });
  expect((await studio()).non_ci_sta).toContain("Storia: Studio per la verifica di sab 31 (mar 27)");
});

test("titoli del piano di prima", async () => {
  const { daTitolo } = await import("../src/studio/api");
  const note = ["Matematica", "Italiano", "TPSIT"];
  expect(daTitolo("[Scuola] Mate – compiti pag. 59", note)).toEqual({ materia: "Matematica", cosa: "compiti pag. 59" });
  expect(daTitolo("[Tutor] Italiano: Francia, epica e Orlando", note)).toEqual({ materia: "Italiano", cosa: "Francia, epica e Orlando" });
  expect(daTitolo("[Scuola] Telecomunicazioni – ripasso", note)).toEqual({ materia: "Telecomunicazioni", cosa: "ripasso" });
});

test("sync: gli eventi del tutor diventano blocchi tuoi, una volta sola, e coprono la materia quel giorno", async () => {
  await E.DB.prepare("INSERT INTO voti (id, materia, data, voto, valore, peso, tipo, periodo, nota, visto_il) VALUES (1, 'Matematica', '2026-10-01', '7', 7, 1, 'Scritto', 1, '', 'x')").run();
  const evento = { evento: "abc@1", titolo: "[Scuola] Mate – compiti pag. 59", descrizione: "Es. 632, 633\n\nCreato dall'agente scolastico",
    inizio: "2026-10-26T20:00:00.000Z", fine: "2026-10-26T20:50:00.000Z" }; // lun 26, 21:00 a Roma
  const r = await sync({ importa: [evento] });
  expect(r.json.adottati).toEqual([{ evento: "abc@1", id: expect.stringMatching(/^b\d+$/) }]);
  const id = r.json.adottati[0].id;
  expect(r.json.blocchi.find((b: any) => b.id === id)).toMatchObject({ titolo: "[Tutor] Matematica: compiti pag. 59", inizio: evento.inizio });
  // il compito di Matematica per mar 27 non si aggiunge: lunedì c'è già il blocco tuo
  expect(r.json.blocchi.filter((b: any) => b.titolo.includes("Matematica")).map((b: any) => b.id)).toEqual([id]);
  const lun = (await blocchi()).find((b: any) => `b${b.id}` === id);
  expect(lun).toMatchObject({ materia: "Matematica", dettagli: "Es. 632, 633", tuo: true, ora: "21:00", durata: 50 });
  expect((await sync({ importa: [evento] })).json.adottati[0].id).toBe(id); // di nuovo: stesso blocco
  expect((await blocchi()).filter((b: any) => b.materia === "Matematica").length).toBe(1);
});

test("ogni blocco dice di che tipo è e per quando", async () => {
  await sync();
  await chiama("POST", "/api/studio", { materia: "Inglese", cosa: "Verbi", data: "2026-10-24", ora: "18:00", durata: 30 });
  const tipi = (await blocchi()).map((b: any) => `${b.data} ${b.materia} ${b.tipo} ${b.scadenza}`);
  expect(tipi).toContain("2026-10-26 Matematica COMPITO 2026-10-27");
  expect(tipi).toContain("2026-10-30 Storia VERIFICA 2026-10-31");
  expect(tipi).toContain("2026-10-24 Inglese TUO null");
});

test("compito fatto dall'agenda: anche i suoi blocchi sono fatti, e tornano da fare", async () => {
  await sync();
  const delCompito = async () => (await blocchi()).filter((b: any) => b.voce_id === 1);
  expect((await delCompito()).length).toBeGreaterThan(0);
  expect((await chiama("PATCH", "/api/agenda/1", { fatto: true })).stato).toBe(200);
  expect((await delCompito()).every((b: any) => b.fatto)).toBe(true);
  await chiama("PATCH", "/api/agenda/1", { fatto: false });
  expect((await delCompito()).every((b: any) => !b.fatto)).toBe(true);
});

test("eliminato per sbaglio: si ripristina dov'era, anche quelli aggiunti a mano", async () => {
  await sync();
  const auto = (await blocchi()).find((b: any) => b.data === "2026-10-28");
  const tuo = (await chiama("POST", "/api/studio", { materia: "Inglese", cosa: "Verbi", data: "2026-10-24", ora: "18:00", durata: 30 })).json.id;
  await chiama("DELETE", `/api/studio/${auto.id}`);
  await chiama("DELETE", `/api/studio/${tuo}`);
  const s = await studio();
  expect(s.eliminati.map((b: any) => b.id)).toEqual([tuo, auto.id]);
  expect((await sync()).json.blocchi.some((b: any) => b.id === `b${auto.id}`)).toBe(false);

  expect((await chiama("POST", `/api/studio/${auto.id}/ripristina`)).stato).toBe(200);
  expect((await chiama("POST", `/api/studio/${tuo}/ripristina`)).stato).toBe(200);
  const dopo = await blocchi();
  expect(dopo.find((b: any) => b.id === auto.id)).toMatchObject({ data: auto.data, ora: auto.ora, tuo: true });
  expect(dopo.find((b: any) => b.id === tuo)).toMatchObject({ data: "2026-10-24", ora: "18:00" });
  expect((await studio()).eliminati).toEqual([]);
  expect((await sync()).json.blocchi.some((b: any) => b.id === `b${auto.id}`)).toBe(true); // torna anche in Calendar
  expect((await chiama("POST", `/api/studio/${auto.id}/ripristina`)).stato).toBe(404);
});
