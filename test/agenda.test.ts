import { expect, test } from "vitest";
import orarioMd from "./fixtures/orario.md?raw";
import { parseOrario, nomeBreve, propostaOrario, scriviOrario } from "../src/registro/orario";
import { oggiRoma } from "../src/registro/date";
import { classificaTipo, materieVoce, scadenza } from "../src/registro/agenda";

const orario = parseOrario(orarioMd);

test("parseOrario", () => {
  expect(orario.giorni[1]).toEqual(["Matematica", "Storia", "Inglese", "Fisica", "Arte"]);
  expect(orario.giorni[6][4]).toBe("Matematica");
  expect(orario.uscita[2]).toBe("14:00");
  expect(orario.senzaRegistro).toEqual(["Arte"]);
  expect(orario.giornata[3]).toBe("leggera");
  expect(orario.giornata[6]).toBeUndefined(); // "—"
  expect(orario.note.startsWith("## Come usarlo")).toBe(true);
});

const giorniDi = (o: ReturnType<typeof parseOrario>) => Object.keys(o.giorni).map(Number).map((giorno) => ({
  giorno, ore: o.giorni[giorno], uscita: o.uscita[giorno] ?? null, giornata: o.giornata[giorno] ?? null,
}));

test("scriviOrario: riscrivendo lo stesso orario non si perde niente", () => {
  const scritto = scriviOrario(orarioMd, giorniDi(orario), orario.senzaRegistro);
  expect(parseOrario(scritto)).toEqual(orario);
  expect(scritto).toContain("# Orario scolastico di esempio");
  expect(scritto).toContain("Le lezioni durano 1 ora.");
  expect(scritto).toContain("- Arte: i compiti non finiscono sul registro. Il giorno prima di Arte il tutor chiede cosa c'è da fare.");
});

test("scriviOrario: cambia la tabella e lascia intatte le regole", () => {
  const scritto = scriviOrario(orarioMd, [{ giorno: 1, ore: ["Fisica", "Storia"], uscita: "10:00", giornata: "leggera" }], ["Arte"]);
  const letto = parseOrario(scritto);
  expect(letto.giorni).toEqual({ 1: ["Fisica", "Storia"] });
  expect(letto.uscita).toEqual({ 1: "10:00" });
  expect(letto.giornata).toEqual({ 1: "leggera" });
  expect(letto.note).toBe(orario.note);
});

test("scriviOrario: materie senza registro", () => {
  const conFisica = parseOrario(scriviOrario(orarioMd, giorniDi(orario), ["Arte", "Fisica"]));
  expect(conFisica.senzaRegistro).toEqual(["Arte", "Fisica"]);
  expect(conFisica.note).toContain("Il giorno prima di Arte il tutor chiede");
  expect(conFisica.note).toContain("## Come usarlo");

  const senza = parseOrario(scriviOrario(orarioMd, giorniDi(orario), []));
  expect(senza.senzaRegistro).toEqual([]);
  expect(senza.note).not.toContain("Materie che non usano il registro");
  expect(senza.note).toContain("## Come usarlo");
});

test("scriviOrario: da zero", () => {
  const giorni = [{ giorno: 2, ore: ["Inglese"], uscita: null, giornata: null }];
  const letto = parseOrario(scriviOrario("", giorni, ["Inglese"]));
  expect(letto.giorni).toEqual({ 2: ["Inglese"] });
  expect(letto.uscita).toEqual({});
  expect(letto.giornata).toEqual({});
  expect(letto.senzaRegistro).toEqual(["Inglese"]);
});

test("propostaOrario: per ogni giorno e ora la materia più frequente", () => {
  const lezioni = [
    { data: "2026-10-19", ora: 1, materia: "Storia" }, // lunedì
    { data: "2026-10-12", ora: 1, materia: "Storia" },
    { data: "2026-10-05", ora: 1, materia: "Supplenza" },
    { data: "2026-10-19", ora: 3, materia: "Inglese" },
    { data: "2026-10-19", ora: 2, materia: "Fisica" },
    { data: "2026-10-20", ora: null, materia: "Arte" }, // senza ora: non dice niente
    { data: "2026-10-25", ora: 1, materia: "Domenica" },
  ];
  expect(propostaOrario(lezioni)).toEqual([{ giorno: 1, ore: ["Storia", "Fisica", "Inglese"], uscita: null, giornata: null }]);
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
  expect(classificaTipo("es. pag. 12 n 7")).toBe("COMPITO");
  expect(classificaTipo("testo argomentativo")).toBe("COMPITO"); // "test" solo come parola intera
});

test("compito: data della voce (= giorno di consegna)", () => {
  // voce datata lunedì 26: è per lunedì 26, non per la lezione dopo
  expect(scadenza({ data: "2026-10-26", testo: "Studiare la teoria a pag. 5, 6, es. pag. 8 n 101" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
});

test("verifica: data della voce", () => {
  expect(scadenza({ data: "2026-10-26", testo: "verifica capitolo 3" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
});

test("data esplicita nel testo vince", () => {
  expect(scadenza({ data: "2026-10-23", testo: "studiare pag. 15 per il 28/10" }))
    .toEqual({ scadenza: "2026-10-28", dedotta: false });
  expect(scadenza({ data: "2026-10-23", testo: "ripasso per lunedì 26" }))
    .toEqual({ scadenza: "2026-10-26", dedotta: false });
  expect(scadenza({ data: "2026-12-20", testo: "entro il 8/1" }).scadenza).toBe("2027-01-08");
});
