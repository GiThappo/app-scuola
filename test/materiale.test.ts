import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { creaApp } from "../src/api";
import { finto } from "./helpers/finto";
import type { Env } from "../src/registro/aggiorna";

const E = env as unknown as Env & { TEST_MIGRATIONS: any };
const ORA = new Date("2026-10-24T10:00:00Z");
const COOKIE = { Cookie: "sessione=prova" };

const chiama = async (metodo: string, path: string, body?: BodyInit, cookie = true) =>
  creaApp({ now: () => ORA, fetchFn: finto().fn }).fetch(
    new Request(`https://app.test${path}`, { method: metodo, body, headers: cookie ? COOKIE : {} }), E);
const url = (p: string) => `/api/file/${p.split("/").map(encodeURIComponent).join("/")}`;

beforeEach(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
  for (const t of ["voti", "lezioni", "agenda", "sessioni", "file", "file_pezzi", "recap"]) await E.DB.exec(`DELETE FROM ${t}`);
  await E.DB.prepare("INSERT INTO sessioni (token, scade) VALUES ('prova', '2099-01-01T00:00:00.000Z')").run();
  await E.DB.prepare("INSERT INTO voti (id, materia, data, voto, valore, peso, tipo, periodo, nota, visto_il) VALUES (1, 'Sistemi e Reti', '2026-10-10', '8', 8, 1, 'Scritto', 1, '', '2026-10-10T00:00:00Z')").run();
});

test("senza login non si carica né si legge niente", async () => {
  expect((await chiama("PUT", url("Storia/fonti/a.pdf"), "x", false)).status).toBe(401);
  expect((await chiama("GET", url("Storia/fonti/a.pdf"), undefined, false)).status).toBe(401);
  expect((await chiama("GET", "/api/recap", undefined, false)).status).toBe(401);
});

test("carica un PDF e lo restituisce identico, anche oltre 1 MB", { timeout: 60_000 }, async () => {
  const dati = new Uint8Array(2_500_000).map((_, i) => (i * 7) % 256);
  const r = await chiama("PUT", url("Storia/fonti/Età dei Comuni.pdf"), dati);
  expect(r.status).toBe(201);
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", dati))].map((b) => b.toString(16).padStart(2, "0")).join("");
  expect(await r.json()).toEqual({ percorso: "Storia/fonti/Età dei Comuni.pdf", sha256: sha });

  const g = await chiama("GET", url("Storia/fonti/Età dei Comuni.pdf"));
  expect(g.status).toBe(200);
  expect(g.headers.get("Content-Type")).toBe("application/pdf");
  expect(g.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''Et%C3%A0%20dei%20Comuni.pdf");
  expect(g.headers.get("Content-Security-Policy")).not.toContain("object-src"); // il visore PDF del browser è un plugin
  expect(new Uint8Array(await g.arrayBuffer())).toEqual(dati);

  const elenco = await (await chiama("GET", "/api/file")).json();
  expect(elenco).toEqual([{ percorso: "Storia/fonti/Età dei Comuni.pdf", materia: "Storia", tipo: "fonti", nome: "Età dei Comuni.pdf",
    mime: "application/pdf", dimensione: 2_500_000, sha256: sha, caricato_il: ORA.toISOString() }]);
});

test("ricaricare sostituisce il contenuto, eliminare lo toglie", async () => {
  await chiama("PUT", url("Storia/fonti/a.pdf"), new Uint8Array(1_200_000));
  await chiama("PUT", url("Storia/fonti/a.pdf"), "corto");
  expect(await (await chiama("GET", url("Storia/fonti/a.pdf"))).text()).toBe("corto");
  expect((await E.DB.prepare("SELECT COUNT(*) AS n FROM file_pezzi").first<{ n: number }>())!.n).toBe(1);

  expect((await chiama("DELETE", url("Storia/fonti/a.pdf"))).status).toBe(200);
  expect((await chiama("GET", url("Storia/fonti/a.pdf"))).status).toBe(404);
  expect((await E.DB.prepare("SELECT COUNT(*) AS n FROM file_pezzi").first<{ n: number }>())!.n).toBe(0);
  expect((await chiama("DELETE", url("Storia/fonti/a.pdf"))).status).toBe(404);
});

test("percorsi e tipi non ammessi", async () => {
  for (const p of ["Storia/a.pdf", "Storia/compiti/a.pdf", "Storia/fonti/a.exe", "Storia/fonti/a.html", "Storia/fonti/sotto/a.pdf", "Storia/fonti/.pdf"]) {
    expect((await chiama("PUT", url(p), "x")).status, p).toBe(400);
  }
});

test("le schede Markdown sono testo UTF-8", async () => {
  await chiama("PUT", url("Sistemi e reti/schede/1. Automi.md"), "# Automi – à");
  const g = await chiama("GET", url("Sistemi e reti/schede/1. Automi.md"));
  expect(g.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
  expect(await g.text()).toBe("# Automi – à");
});

test("la materia mostra il suo materiale, anche se la cartella ha maiuscole diverse", async () => {
  await chiama("PUT", url("Sistemi e reti/schede/2. Turing.md"), "b");
  await chiama("PUT", url("Sistemi e reti/schede/1. Automi.md"), "a");
  await chiama("PUT", url("Sistemi e reti/fonti/link.md"), "l");
  await chiama("PUT", url("Storia/fonti/a.pdf"), "x");
  const m = (await (await chiama("GET", `/api/materie/${encodeURIComponent("Sistemi e Reti")}`)).json()) as any;
  expect(m.materiale.schede.map((f: any) => f.nome)).toEqual(["1. Automi.md", "2. Turing.md"]);
  expect(m.materiale.fonti.map((f: any) => f.percorso)).toEqual(["Sistemi e reti/fonti/link.md"]);
  expect(m.materiale.appunti).toEqual([]);

  // una materia che ha solo materiale compare comunque
  const elenco = (await (await chiama("GET", "/api/materie")).json()) as any[];
  expect(elenco.map((x) => x.nome)).toEqual(["Sistemi e Reti", "Storia"]);
  const storia = (await (await chiama("GET", "/api/materie/Storia")).json()) as any;
  expect(storia.materiale.fonti[0].nome).toBe("a.pdf");
});

test("recap: carica, elenca dal più recente, leggi", async () => {
  expect((await chiama("PUT", "/api/recap/2026-10-23", "REPORT DEL VENERDÌ")).status).toBe(201);
  await chiama("PUT", "/api/recap/2026-10-24", "REPORT DEL SABATO");
  await chiama("PUT", "/api/recap/2026-10-24", "REPORT DEL SABATO (aggiornato)");
  expect(await (await chiama("GET", "/api/recap")).json()).toEqual([{ data: "2026-10-24" }, { data: "2026-10-23" }]);
  expect(await (await chiama("GET", "/api/recap/2026-10-24")).json()).toEqual({ data: "2026-10-24", testo: "REPORT DEL SABATO (aggiornato)", caricato_il: ORA.toISOString() });
  expect((await chiama("GET", "/api/recap/2026-10-20")).status).toBe(404);
  expect((await chiama("PUT", "/api/recap/ieri", "x")).status).toBe(400);
  expect((await chiama("PUT", "/api/recap/2026-10-25", "")).status).toBe(400);
});
