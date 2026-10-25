import { expect, test } from "vitest";
import orarioMd from "./fixtures/orario.md?raw";
import { parseOrario, nomeBreve } from "../src/registro/orario";
import { oggiRoma } from "../src/registro/date";
import { classificaTipo, materieVoce, scadenza } from "../src/registro/agenda";

const orario = parseOrario(orarioMd);

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

test("compito: data della voce (= giorno di consegna)", () => {
  // voce datata lunedì 26: è per lunedì 26, non per la lezione dopo
  expect(scadenza({ data: "2026-10-26", testo: "Studiare la teoria a pag. 19, 20, es. pag. 62 n 701" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
});

test("verifica: data della voce", () => {
  expect(scadenza({ data: "2026-10-26", testo: "verifica Medioevo" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
});

test("data esplicita nel testo vince", () => {
  expect(scadenza({ data: "2026-10-23", testo: "studiare pag. 79 per il 28/10" }))
    .toEqual({ scadenza: "2026-10-28", dedotta: false });
  expect(scadenza({ data: "2026-10-23", testo: "ripasso per lunedì 26" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
  expect(scadenza({ data: "2026-12-20", testo: "entro il 8/1" }).scadenza).toBe("2027-01-08");
});
