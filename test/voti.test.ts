import { expect, test } from "vitest";
import { blu, valore, media, type VotoCV } from "../src/registro/voti";

const v = (o: Partial<VotoCV>): VotoCV => ({
  evtId: 1, evtDate: "2026-10-10", subjectDesc: "STORIA", displayValue: "7", decimalValue: null, weightFactor: 1,
  canceled: false, noAverage: false, componentDesc: "Orale", periodPos: 1, periodLabel: "1° Quadrimestre", notesForFamily: "",
  ...o,
});

test("valore", () => {
  expect(valore(v({ displayValue: "6+" }))).toBe(6.25);
  expect(valore(v({ displayValue: "6-" }))).toBe(5.75);
  expect(valore(v({ displayValue: "9½" }))).toBe(9.5);
  expect(valore(v({ displayValue: "7 1/2" }))).toBe(7.5);
  expect(valore(v({ displayValue: "8", decimalValue: 8.25 }))).toBe(8.25);
});

test("voti che non fanno media", () => {
  for (const d of ["g", "ns", "+", "7-8", "buono"]) expect(valore(v({ displayValue: d }))).toBeNull();
  expect(valore(v({ displayValue: "8", canceled: true }))).toBeNull();
  expect(valore(v({ displayValue: "8", noAverage: true }))).toBeNull();
  // blu su Classeviva: si vede il voto ma non fa media (decimalValue vuoto)
  expect(valore(v({ displayValue: "6", color: "blue" }))).toBeNull();
  expect(blu(v({ displayValue: "6", color: "blue" }))).toBe(true);
  expect(blu(v({ displayValue: "6", color: "green" }))).toBe(false);
});

test("media pesata", () => {
  expect(media([v({ displayValue: "8", weightFactor: 1 }), v({ displayValue: "9½", weightFactor: 1 })])).toBe(8.75);
  expect(media([v({ displayValue: "6", weightFactor: 2 }), v({ displayValue: "9", weightFactor: 1 })])).toBe(7);
  expect(media([v({ displayValue: "6", weightFactor: null })])).toBe(6);
  expect(media([v({ displayValue: "ns" })])).toBeNull();
});
