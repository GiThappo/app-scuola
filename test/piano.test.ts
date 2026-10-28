import { expect, test } from "vitest";
import orarioMd from "./fixtures/orario.md?raw";
import { parseOrario } from "../src/registro/orario";
import { pianifica, stimaDurata, type InputPiano } from "../src/studio/piano";
import { localeRoma, utcDaRoma } from "../src/studio/ore";

const orario = parseOrario(orarioMd);
const base = (o: Partial<InputPiano> = {}): InputPiano => ({
  adesso: "2026-10-23T16:00", // venerdì, uscita 14:15
  voci: [],
  orario,
  giorniSenzaScuola: new Set(),
  occupato: [],
  chiaviTenute: new Set(),
  materieDeboli: [],
  argomenti: {},
  tuoi: [],
  ...o,
});
const voce = (id: number, tipo: string, scadenza: string, materia = "Matematica", testo = `testo ${id}`) =>
  ({ id, materie: [materia], testo, tipo, scadenza });
const orari = (r: ReturnType<typeof pianifica>) => r.blocchi.map((b) => `${b.inizio} ${b.durata}`);

test("ore di Roma ↔ UTC, anche col cambio d'ora", () => {
  expect(localeRoma(new Date("2026-10-23T14:00:00Z"))).toBe("2026-10-23T16:00");
  expect(utcDaRoma("2026-10-23T16:00")).toBe("2026-10-23T14:00:00.000Z");
  expect(utcDaRoma("2026-10-26T16:00")).toBe("2026-10-26T15:00:00.000Z"); // dopo il 25/10 è ora solare
});

test("compito: il giorno prima della scadenza; domenica si studia la mattina", () => {
  const r = pianifica(base({ voci: [voce(1, "COMPITO", "2026-10-26")] }));
  expect(orari(r)).toEqual(["2026-10-25T10:00 45"]);
  expect(r.blocchi[0]).toMatchObject({ chiave: "v1", materia: "Matematica", voceId: 1, cosa: "Compito per lun 26" });
  expect(r.nonCiSta).toEqual([]);
});

test("compito per domani: oggi dopo l'ora attuale, a blocchi da 30 nei giorni pesanti", () => {
  const r = pianifica(base({ adesso: "2026-10-23T16:20", voci: [voce(1, "COMPITO", "2026-10-24")] }));
  expect(orari(r)).toEqual(["2026-10-23T16:30 30", "2026-10-23T17:10 15"]);
  expect(r.blocchi.map((b) => b.chiave)).toEqual(["v1:1", "v1:2"]);
});

test("verifica: 60 min nei 4 giorni prima, ripasso leggero la sera prima, con gli argomenti recenti", () => {
  const r = pianifica(base({ voci: [voce(2, "VERIFICA", "2026-10-29")], argomenti: { Matematica: ["Disequazioni", "Parabola"] } }));
  expect(orari(r)).toEqual([
    "2026-10-25T10:00 60", // dom
    "2026-10-26T15:00 60", // lun
    "2026-10-27T16:00 30", "2026-10-27T16:40 30", // mar: giorno pesante
    "2026-10-28T15:00 30", // mer: ripasso
  ]);
  expect(r.blocchi[0].cosa).toBe("Studio per la verifica di gio 29");
  expect(r.blocchi.at(-1)!.cosa).toBe("Ripasso leggero per la verifica di gio 29");
  expect(r.blocchi[0].dettagli).toBe("testo 2\nArgomenti recenti: Disequazioni; Parabola");
});

test("interrogazione: 45 min nei 3 giorni prima, 30 la sera prima; i giorni già passati si saltano", () => {
  const r = pianifica(base({ voci: [voce(3, "INTERROGAZIONE", "2026-10-26", "Storia")] }));
  // ven 23 (oggi, D-3) pesante, sab 24, dom 25 ripasso
  expect(orari(r)).toEqual(["2026-10-23T16:00 30", "2026-10-23T16:40 15", "2026-10-24T15:00 45", "2026-10-25T10:00 30"]);
});

test("impegni e blocchi tenuti non si sovrappongono, con 10 minuti di pausa dopo i blocchi", () => {
  const r = pianifica(base({
    voci: [voce(1, "COMPITO", "2026-10-27")], // lun 26
    occupato: [{ inizio: "2026-10-26T15:00", fine: "2026-10-26T16:30" }, { inizio: "2026-10-26T16:30", fine: "2026-10-26T17:10" }],
  }));
  expect(orari(r)).toEqual(["2026-10-26T17:10 45"]);
});

test("sessioni già coperte (spostate, fatte, eliminate) non si rifanno", () => {
  const r = pianifica(base({ voci: [voce(2, "VERIFICA", "2026-10-29")], chiaviTenute: new Set(["v2:-4", "v2:-2:1"]) }));
  expect(r.blocchi.map((b) => b.chiave)).toEqual(["v2:-3", "v2:-2:2", "v2:-1"]); // l'altra metà di martedì resta
});

test("se il tempo non basta lo dice; il compito prova anche i giorni prima", () => {
  const pieno = (g: string) => ({ inizio: `${g}T00:00`, fine: `${g}T23:59` });
  const r = pianifica(base({
    voci: [voce(1, "COMPITO", "2026-10-27"), voce(2, "VERIFICA", "2026-10-27", "Inglese")],
    occupato: [pieno("2026-10-26"), pieno("2026-10-25"), pieno("2026-10-24")],
  }));
  expect(r.blocchi.map((b) => `${b.chiave} ${b.inizio}`)).toEqual(["v1:1 2026-10-23T16:00", "v1:2 2026-10-23T16:40", "v2:-4:1 2026-10-23T17:05", "v2:-4:2 2026-10-23T17:45"]);
  expect(r.nonCiSta).toEqual([
    "Inglese: Studio per la verifica di mar 27 (sab 24)",
    "Inglese: Studio per la verifica di mar 27 (dom 25)",
    "Inglese: Ripasso leggero per la verifica di mar 27 (lun 26)",
  ]);
});

test("materie sotto il 6: ripasso il mercoledì", () => {
  const r = pianifica(base({ materieDeboli: ["TPSIT"] }));
  expect(r.blocchi.map((b) => `${b.chiave} ${b.inizio} ${b.durata} ${b.cosa}`)).toEqual([
    "rTPSIT:2026-10-28 2026-10-28T15:00 45 Ripasso (media sotto 6)",
    "rTPSIT:2026-11-04 2026-11-04T15:00 45 Ripasso (media sotto 6)",
  ]);
});

test("giorni senza scuola: anche la mattina; solo i prossimi 14 giorni", () => {
  const r = pianifica(base({ voci: [voce(1, "COMPITO", "2026-10-29"), voce(9, "VERIFICA", "2026-12-01")], giorniSenzaScuola: new Set(["2026-10-28"]) }));
  expect(orari(r)).toEqual(["2026-10-28T10:00 45"]);
});

test("di sera: il compito per domani si fa stasera (fino alle 22), lo studio di oggi già perso non si segnala", () => {
  const r = pianifica(base({ adesso: "2026-10-23T20:26", voci: [voce(1, "COMPITO", "2026-10-24"), voce(2, "VERIFICA", "2026-10-26", "Italiano")] }));
  expect(r.blocchi.filter((b) => b.voceId === 1).map((b) => `${b.inizio} ${b.durata}`)).toEqual(["2026-10-23T20:30 30", "2026-10-23T21:10 15"]);
  expect(r.nonCiSta).toEqual([]);
  const tardi = pianifica(base({ adesso: "2026-10-23T21:50", voci: [voce(1, "COMPITO", "2026-10-24")] }));
  expect(tardi.nonCiSta).toEqual(["Matematica: Compito per sab 24 (ven 23)"]);
});

test("la sera in più parte dalle 19:30, mai durante la scuola", () => {
  const pieno = { inizio: "2026-10-26T15:00", fine: "2026-10-26T19:30" };
  const r = pianifica(base({ adesso: "2026-10-26T11:00", voci: [voce(1, "COMPITO", "2026-10-27")], occupato: [pieno] }));
  expect(r.blocchi.map((b) => b.inizio)).toEqual(["2026-10-26T19:30"]);
});

test("un blocco tuo della stessa materia quel giorno copre la sessione (anche il piano fatto prima dal tutor)", () => {
  const r = pianifica(base({
    voci: [voce(1, "COMPITO", "2026-10-24"), voce(2, "VERIFICA", "2026-10-26", "Italiano")],
    tuoi: [{ giorno: "2026-10-23", materia: "Matematica", testo: "compiti" }, { giorno: "2026-10-24", materia: "italiano", testo: "ripasso" }],
  }));
  expect(r.blocchi.map((b) => `${b.chiave} ${b.inizio.slice(0, 10)}`)).toEqual(["v2:-3:1 2026-10-23", "v2:-3:2 2026-10-23", "v2:-1 2026-10-25"]);
});

test("un blocco tuo della stessa materia che parla d'altro non copre i compiti", () => {
  const testo = "Studiare la teoria a pag. 73, 74, 75, es. pag. 96 n 3, 9, 10";
  const r = pianifica(base({
    adesso: "2026-10-28T14:00", // mer, giorno leggero
    voci: [voce(1, "COMPITO", "2026-10-29", "Matematica", testo)],
    tuoi: [{ giorno: "2026-10-28", materia: "Matematica", testo: "disequazioni con valore assoluto (2/3)" }],
  }));
  expect(r.blocchi.map((b) => `${b.chiave} ${b.inizio} ${b.durata}`)).toEqual(["v1 2026-10-28T15:00 50"]);
  // lo copre solo se parla delle stesse pagine
  const coperto = pianifica(base({
    adesso: "2026-10-28T14:00", voci: [voce(1, "COMPITO", "2026-10-29", "Matematica", testo)],
    tuoi: [{ giorno: "2026-10-28", materia: "Matematica", testo: "teoria pag. 73-75" }],
  }));
  expect(coperto.blocchi).toEqual([]);
});

test("durata del compito stimata dal testo: 10 min a pagina di teoria, 6 a esercizio, a pezzi da un'ora al massimo", () => {
  const testo = "Studiare la teoria a pag. 73, 74, 75, es. pag. 96 n 3, 9, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24";
  const r = pianifica(base({ adesso: "2026-10-28T14:00", voci: [voce(1, "COMPITO", "2026-10-29", "Matematica", testo)] }));
  expect(orari(r)).toEqual(["2026-10-28T15:00 60", "2026-10-28T16:10 45"]); // 30 + 72 = 102 → 105
  expect(r.blocchi.map((b) => b.chiave)).toEqual(["v1:1", "v1:2"]);
});

test("stimaDurata", () => {
  expect(stimaDurata("Studiare la teoria a pag. 73, 74, 75, es. pag. 96 n 3, 9, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24")).toBe(105);
  expect(stimaDurata("Es. pag. 58 dal n 612 al n 624")).toBe(80); // 13 esercizi
  expect(stimaDurata("Studiare pag. 19-20")).toBe(30); // minimo mezz'ora
  expect(stimaDurata("Studiare la teoria a pag. 19, 20, es. pag. 62 n 701, 703, 705, 707, 708, 709, 713, 715, 718, 720, 723")).toBe(90);
  expect(stimaDurata("Leggere il capitolo")).toBe(45); // non si capisce: come prima
  expect(stimaDurata("es. 1-40")).toBe(120); // massimo due ore
});
