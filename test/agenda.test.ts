import { expect, test } from "vitest";
import orarioMd from "./fixtures/orario.md?raw";
import { parseOrario, nomeBreve } from "../src/registro/orario";
import { oggiRoma } from "../src/registro/date";
import { classificaTipo, materieVoce, scadenza } from "../src/registro/agenda";

const orario = parseOrario(orarioMd);
const scuola = new Set(["2026-10-24", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]); // 25 domenica

test("parseOrario", () => {
  expect(orario.giorni[1]).toEqual(["Inglese", "TPSIT", "Italiano", "Matematica", "Telecomunicazioni"]);
  expect(orario.giorni[6][4]).toBe("Matematica");
  expect(orario.uscita[2]).toBe("14:15");
  expect(orario.senzaRegistro).toEqual(["Italiano"]);
});

test("nomeBreve", () => {
  expect(nomeBreve("MATEMATICA E COMPLEMENTI DI MATEMATICA")).toBe("Matematica");
  expect(nomeBreve("SCIENZE MOTORIE E SPORTIVE")).toBe("Scienze motorie");
  expect(nomeBreve("FILOSOFIA")).toBe("Filosofia");
});

test("oggiRoma vicino a mezzanotte", () => {
  expect(oggiRoma(new Date("2026-10-23T23:30:00Z"))).toBe("2026-10-24"); // 01:30 a Roma (ora legale)
  expect(oggiRoma(new Date("2026-10-23T21:30:00Z"))).toBe("2026-10-23");
});

test("tipo", () => {
  expect(classificaTipo("Verifica scritta cap. 3")).toBe("VERIFICA");
  expect(classificaTipo("interrogazioni programmate")).toBe("INTERROGAZIONE");
  expect(classificaTipo("es. pag. 59 n 632")).toBe("COMPITO");
  expect(classificaTipo("testo argomentativo")).toBe("COMPITO"); // "test" solo come parola intera
});

test("compito: prossima lezione della materia", () => {
  // venerdì 23 → prossima Matematica sabato 24
  expect(scadenza({ data: "2026-10-23", tipo: "COMPITO", testo: "es. pag. 59", materie: ["Matematica"] }, orario, scuola, "2026-11-13"))
    .toEqual({ scadenza: "2026-10-24", dedotta: true });
  // sabato 24 → Italiano: domenica no, lunedì 26 sì
  expect(scadenza({ data: "2026-10-24", tipo: "COMPITO", testo: "leggere", materie: ["Italiano"] }, orario, scuola, "2026-11-13").scadenza).toBe("2026-10-26");
});

test("verifica: data della voce", () => {
  expect(scadenza({ data: "2026-10-26", tipo: "VERIFICA", testo: "verifica Medioevo", materie: ["Italiano"] }, orario, scuola, "2026-11-13"))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
});

test("data esplicita nel testo vince", () => {
  expect(scadenza({ data: "2026-10-23", tipo: "COMPITO", testo: "studiare pag. 79 per il 28/10", materie: ["Italiano"] }, orario, scuola, "2026-11-13"))
    .toEqual({ scadenza: "2026-10-28", dedotta: false });
  expect(scadenza({ data: "2026-10-23", tipo: "COMPITO", testo: "ripasso per lunedì 26", materie: ["Italiano"] }, orario, scuola, "2026-11-13"))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
  expect(scadenza({ data: "2026-12-20", tipo: "COMPITO", testo: "entro il 8/1", materie: ["Italiano"] }, orario, scuola, "2027-01-10").scadenza).toBe("2027-01-08");
});

test("nessuna lezione nota → data da controllare", () => {
  expect(scadenza({ data: "2026-10-31", tipo: "COMPITO", testo: "esercizi", materie: ["Matematica"] }, orario, scuola, "2026-10-31"))
    .toEqual({ scadenza: null, dedotta: false });
  expect(scadenza({ data: "2026-10-23", tipo: "COMPITO", testo: "esercizi", materie: [] }, orario, scuola, "2026-11-13").scadenza).toBeNull();
});

test("docente con due materie: decide l'orario del giorno", () => {
  const dm = new Map([["Prof. A", ["Sistemi e reti", "TPSIT"]]]);
  expect(materieVoce({ subjectDesc: null, authorName: "Prof. A", evtDatetimeBegin: "2026-10-26T08:00:00+01:00" }, dm, orario)).toEqual(["TPSIT"]);
  expect(materieVoce({ subjectDesc: null, authorName: "Prof. A", evtDatetimeBegin: "2026-10-27T08:00:00+01:00" }, dm, orario)).toEqual(["Sistemi e reti"]);
  expect(materieVoce({ subjectDesc: null, authorName: "Prof. A", evtDatetimeBegin: "2026-10-31T08:00:00+01:00" }, dm, orario)).toEqual(["Sistemi e reti", "TPSIT"]);
  expect(materieVoce({ subjectDesc: "STORIA", authorName: "Prof. A", evtDatetimeBegin: "2026-10-26T08:00:00+01:00" }, dm, orario)).toEqual(["Storia"]);
  expect(materieVoce({ subjectDesc: null, authorName: "Prof. Z", evtDatetimeBegin: "2026-10-26T08:00:00+01:00" }, dm, orario)).toEqual([]);
});
