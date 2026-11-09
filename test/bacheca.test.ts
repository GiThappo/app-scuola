import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { creaApp } from "../src/api";
import { aggiorna, type Env } from "../src/registro/aggiorna";
import { salvaCredenziali } from "../src/registro/credenziali";
import { finto } from "./helpers/finto";

const E = env as unknown as Env & { TEST_MIGRATIONS: any; APP_PASSWORD?: string };
const ORA = new Date("2026-10-23T14:00:00Z");
const COOKIE = { Cookie: "sessione=prova" };

// Dati inventati: questo file finisce anche nel modello pubblico
const circolare = (id: number, titolo: string, letta: boolean, allegati = [{ fileName: `${titolo}.pdf`, attachNum: 1 }]) => ({
  pubId: id, evtCode: "CF_SDG", cntTitle: titolo, cntCategory: "Documenti", pubDT: "2026-10-20T10:00:00+02:00",
  readStatus: letta, cntValidInRange: true, cntStatus: "active", attachments: allegati,
});
const corpi = (items: unknown[]): [string, unknown][] => [["/noticeboard/readmulti/", { item: {} }], ["/noticeboard/attach/", { contenuto: "pdf" }], ["/noticeboard", { items }]];

const chiama = async (metodo: string, path: string, corpo?: unknown, fn = finto().fn) =>
  creaApp({ now: () => ORA, fetchFn: fn }).fetch(new Request(`https://app.test${path}`, {
    method: metodo, headers: { ...COOKIE, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }), E);
const elenco = async () => ((await (await chiama("GET", "/api/bacheca")).json()) as any).voci as any[];
const scarica = (items: unknown[]) => aggiorna(E, ORA, finto({ corpi: corpi(items) }).fn);
const riassunto = { riguarda: "si", destinatari: "Classe di prova", riassunto: "Di cosa parla", da_fare: "Portare il modulo" };

beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  for (const t of ["bacheca", "impostazioni", "sessioni"]) await E.DB.exec(`DELETE FROM ${t}`);
  await E.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('prova', '2099-01-01T00:00:00.000Z')").run();
});

test("l'aggiornamento porta le circolari nell'app, senza riassunto e da leggere", async () => {
  await scarica([circolare(1, "Gita", false)]);
  expect(await elenco()).toMatchObject([{ id: 1, titolo: "Gita", data: "2026-10-20", letta: false, vista: false, riassunto: null, gruppo: "da_leggere" }]);
});

test("se la bacheca non arriva restano le circolari di prima", async () => {
  await scarica([circolare(1, "Gita", false)]);
  await aggiorna(E, ORA, finto().fn);
  expect((await elenco()).map((v) => v.id)).toEqual([1]);
});

test("le circolari tolte da Classeviva spariscono e quelle cancellate non si mostrano", async () => {
  await scarica([circolare(1, "Gita", false), circolare(2, "Assemblea", false)]);
  await scarica([circolare(2, "Assemblea", false), { ...circolare(3, "Annullata", false), cntStatus: "deleted" }]);
  expect((await elenco()).map((v) => v.id)).toEqual([2]);
});

test("una circolare già letta su Classeviva al primo arrivo non è evidenziata", async () => {
  await scarica([circolare(1, "Gita", true)]);
  expect((await elenco())[0].vista).toBe(true);
});

test("il gruppo segue il riassunto: nel dubbio resta da leggere", async () => {
  await scarica([circolare(1, "A", false), circolare(2, "B", false), circolare(3, "C", false)]);
  await chiama("PUT", "/api/bacheca/1/riassunto", riassunto);
  await chiama("PUT", "/api/bacheca/2/riassunto", { ...riassunto, riguarda: "forse" });
  await chiama("PUT", "/api/bacheca/3/riassunto", { ...riassunto, riguarda: "no" });
  expect(Object.fromEntries((await elenco()).map((v) => [v.id, v.gruppo]))).toEqual({ 1: "ti_riguardano", 2: "da_leggere", 3: "non_ti_riguardano" });
});

test("il riassunto sopravvive agli aggiornamenti successivi", async () => {
  await scarica([circolare(1, "Gita", false)]);
  await chiama("PUT", "/api/bacheca/1/riassunto", riassunto);
  await scarica([circolare(1, "Gita", true)]);
  expect((await elenco())[0]).toMatchObject({ riassunto: "Di cosa parla", da_fare: "Portare il modulo", letta: true });
});

test("il tutor che apre la circolare non la toglie dalle evidenziate", async () => {
  await scarica([circolare(1, "Gita", false)]);
  await scarica([circolare(1, "Gita", true)]);
  expect((await elenco())[0].vista).toBe(false);
});

test("una circolare scaricata dopo essere stata aperta dal tutor resta evidenziata se non era letta", async () => {
  await scarica([circolare(1, "Gita", true)]);
  await chiama("PUT", "/api/bacheca/1/riassunto", { ...riassunto, vista: false });
  expect((await elenco())[0].vista).toBe(false);
});

test("ricaricare un riassunto non rimette tra le evidenziate una circolare già vista", async () => {
  await scarica([circolare(1, "Gita", false)]);
  await chiama("PUT", "/api/bacheca/1/riassunto", { ...riassunto, vista: false });
  await chiama("PATCH", "/api/bacheca/1", { vista: true });
  await chiama("PUT", "/api/bacheca/1/riassunto", { ...riassunto, riassunto: "Corretto", vista: false });
  expect((await elenco())[0]).toMatchObject({ vista: true, riassunto: "Corretto" });
});

test("riassunti non validi o di circolari inesistenti vengono rifiutati", async () => {
  await scarica([circolare(1, "Gita", false)]);
  expect((await chiama("PUT", "/api/bacheca/1/riassunto", { ...riassunto, riguarda: "boh" })).status).toBe(400);
  expect((await chiama("PUT", "/api/bacheca/1/riassunto", { ...riassunto, riassunto: " " })).status).toBe(400);
  expect((await chiama("PUT", "/api/bacheca/99/riassunto", riassunto)).status).toBe(404);
});

test("gli allegati di servizio non si mostrano", async () => {
  await scarica([circolare(1, "Gita", false, [{ fileName: "Gita.pdf", attachNum: 1 }, { fileName: "annotazione_Gita.pdf", attachNum: 2 }, { fileName: "Modulo.docx", attachNum: 3 }])]);
  expect((await elenco())[0].allegati).toEqual([{ n: 1, nome: "Gita.pdf" }, { n: 3, nome: "Modulo.docx" }]);
});

test("aprire un allegato lo segna letto su Classeviva prima di scaricarlo", async () => {
  await salvaCredenziali(E, "utente", "password");
  await scarica([circolare(1, "Gita", false)]);
  const f = finto({ corpi: corpi([]) });
  const r = await chiama("GET", "/api/bacheca/1/allegato/1", undefined, f.fn);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/pdf");
  const percorsi = f.richieste.map((x) => x.url);
  const lettura = percorsi.findIndex((u) => u.includes("/noticeboard/readmulti/CF_SDG/1/"));
  expect(lettura).toBeGreaterThan(-1);
  expect(f.richieste[lettura].init?.method).toBe("POST");
  expect(percorsi.findIndex((u) => u.includes("/noticeboard/attach/CF_SDG/1/1"))).toBeGreaterThan(lettura);
  expect((await elenco())[0]).toMatchObject({ letta: true, vista: true });
});

test("un allegato che non sia un PDF si scarica e non si apre nella pagina", async () => {
  await salvaCredenziali(E, "utente", "password");
  await scarica([circolare(1, "Gita", false, [{ fileName: "Modulo.docx", attachNum: 1 }])]);
  const r = await chiama("GET", "/api/bacheca/1/allegato/1", undefined, finto({ corpi: corpi([]) }).fn);
  expect(r.headers.get("content-type")).toBe("application/octet-stream");
  expect(r.headers.get("content-disposition")).toMatch(/^attachment/);
});

test("non si possono chiedere allegati che la circolare non ha", async () => {
  await salvaCredenziali(E, "utente", "password");
  await scarica([circolare(1, "Gita", false)]);
  const f = finto({ corpi: corpi([]) });
  expect((await chiama("GET", "/api/bacheca/1/allegato/7", undefined, f.fn)).status).toBe(404);
  expect(f.richieste).toEqual([]);
});

test("la bacheca richiede il login", async () => {
  const r = await creaApp({ now: () => ORA, fetchFn: finto().fn }).fetch(new Request("https://app.test/api/bacheca"), E);
  expect(r.status).toBe(401);
});
