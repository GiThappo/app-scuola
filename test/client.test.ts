import { expect, test } from "vitest";
import { scaricaRegistro, ErroreClasseviva } from "../src/classeviva/client";
import { finto } from "./helpers/finto";
import grades from "./fixtures/grades.json";
import subjects from "./fixtures/subjects.json";
import periods from "./fixtures/periods.json";
import agenda from "./fixtures/agenda.json";
import lessons from "./fixtures/lessons.json";
import calendar from "./fixtures/calendar.json";
import didactics from "./fixtures/didactics.json";

const PASSWORD = "p@ss segreta&1";

test("scarica tutte le liste", async () => {
  const { fn } = finto();
  const d = await scaricaRegistro("S0000000X", PASSWORD, "2026-10-23", fn);
  expect(d.voti.length).toBe(grades.grades.length);
  expect(d.materie.length).toBe(subjects.subjects.length);
  expect(d.periodi.length).toBe(periods.periods.length);
  expect(d.agenda.length).toBe(agenda.agenda.length);
  expect(d.lezioni.length).toBe(lessons.lessons.length);
  expect(d.calendario.length).toBe(calendar.calendar.length);
  expect(d.didattica).toEqual(didactics.didacticts);
  expect(d.medie?.subjectAverages["2"].globalAverage.average).toBe(6.75);
});

test("medie di Classeviva: se non arrivano non è un errore", async () => {
  const { fn } = finto({ stato: (url) => (url.endsWith("/avg") ? 500 : 200) });
  const d = await scaricaRegistro("u", "p", "2026-10-23", fn);
  expect(d.medie).toBeNull();
  expect(d.voti.length).toBe(grades.grades.length);
});

test("login con intestazioni, credenziali codificate e cookie della sessione", async () => {
  const { fn, richieste } = finto();
  await scaricaRegistro("S0000000X", PASSWORD, "2026-10-23", fn);
  const login = richieste.find((r) => r.url.includes("AuthApi4"))!;
  expect(String(login.init?.body)).toContain("uid=S0000000X");
  expect(String(login.init?.body)).toContain(`pwd=${encodeURIComponent(PASSWORD).replace(/%20/g, "+")}`);
  const h = new Headers(login.init?.headers);
  expect(h.get("Z-Dev-ApiKey")).toBe("Tg1NWEwNGIgIC0K");
  expect(h.get("User-Agent")).toBe("CVVS/std/4.2.3 Android/12");
  expect(h.get("Cookie")).toBe("PHPSESSID=primo");
  for (const r of richieste.filter((r) => r.url.includes("/rest/w1/"))) {
    expect(new Headers(r.init?.headers).get("Cookie")).toBe("PHPSESSID=secondo");
  }
});

test("intervalli di date e anno dei voti", async () => {
  const { fn, richieste } = finto();
  await scaricaRegistro("u", "p", "2026-10-23", fn);
  const url = (k: string) => richieste.find((r) => r.url.includes(k))!.url;
  expect(url("/grades")).toMatch(/\/students\/1234567\/grades26$/);
  expect(url("/agendav2/")).toMatch(/agendav2\/all\/20261016\/20261122$/);
  expect(url("/lessons/")).toMatch(/lessons\/20261002\/20261023$/);
  expect(url("/calendar/")).toMatch(/calendar\/20261023\/20261113$/);

  const a = finto();
  await scaricaRegistro("u", "p", "2026-09-10", a.fn);
  expect(a.richieste.find((r) => r.url.includes("/lessons/"))!.url).toMatch(/lessons\/20260901\/20260910$/);
  const b = finto();
  await scaricaRegistro("u", "p", "2027-03-10", b.fn);
  expect(b.richieste.find((r) => r.url.includes("/grades"))!.url).toMatch(/grades26$/);
  const c = finto();
  await scaricaRegistro("u", "p", "2027-09-15", c.fn);
  expect(c.richieste.find((r) => r.url.includes("/grades"))!.url).toMatch(/grades27$/);
});

test("login rifiutato", async () => {
  const { fn } = finto({ login: { data: { auth: { loggedIn: false, errors: ["Identificativo o password errati"] } } } });
  const err = await scaricaRegistro("u", PASSWORD, "2026-10-23", fn).catch((e) => e);
  expect(err).toBeInstanceOf(ErroreClasseviva);
  expect(err.fase).toBe("login");
  expect(err.message).toBe("Identificativo o password errati");
  expect(String(err)).not.toContain(PASSWORD);
});

test("403 da Classeviva", async () => {
  const { fn } = finto({ stato: (u) => (u.includes("login.php") ? 403 : 200) });
  const err = await scaricaRegistro("u", PASSWORD, "2026-10-23", fn).catch((e) => e);
  expect(err).toBeInstanceOf(ErroreClasseviva);
  expect(err.stato).toBe(403);
  expect(String(err)).not.toContain(PASSWORD);
  const dati = finto({ stato: (u) => (u.includes("/grades") ? 403 : 200) });
  const err2 = await scaricaRegistro("u", PASSWORD, "2026-10-23", dati.fn).catch((e) => e);
  expect(err2.fase).toBe("dati");
  expect(err2.stato).toBe(403);
});

test("didattica non disponibile non blocca", async () => {
  const { fn } = finto({ stato: (u) => (u.includes("/didactics") ? 500 : 200) });
  const d = await scaricaRegistro("u", "p", "2026-10-23", fn);
  expect(d.didattica).toEqual([]);
  expect(d.voti.length).toBeGreaterThan(0);
});
