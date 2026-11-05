import type { Hono } from "hono";
import type { Env } from "../registro/aggiorna";
import { stessaMateria } from "../registro/orario";
import { oggiRoma } from "../registro/date";
import { recapAutomatico } from "../registro/recap";

const PEZZO = 1_000_000; // byte: in D1 una riga non può superare 2 MB
const MAX_FILE = 25_000_000;
const MAX_RECAP = 200_000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const TIPI = ["schede", "fonti", "appunti"] as const;
const MIME: Record<string, string> = {
  pdf: "application/pdf", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};
// Il visore PDF del browser è un plugin: con object-src 'none' non si aprirebbe
const CSP_FILE = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'";

export type RigaFile = { percorso: string; materia: string; tipo: string; nome: string; mime: string; dimensione: number; sha256: string; caricato_il: string };

/** "<Materia>/<schede|fonti|appunti>/<nome.estensione>" → parti, oppure null se non è ammesso. */
export function leggiPercorso(percorso: string) {
  const parti = percorso.split("/");
  if (parti.length !== 3) return null;
  const [materia, tipo, nome] = parti.map((p) => p.trim());
  const est = nome.match(/.\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  if (!materia || materia.length > 60 || materia.startsWith(".") || !(TIPI as readonly string[]).includes(tipo)) return null;
  if (nome.length > 200 || nome.startsWith(".") || !est || !MIME[est]) return null;
  return { materia, tipo, nome, mime: MIME[est] };
}

const esadecimale = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function materialeDi(db: D1Database, materia: string) {
  const righe = (await db.prepare("SELECT * FROM file").all<RigaFile>()).results
    .filter((f) => stessaMateria(f.materia, materia))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it", { numeric: true }));
  return Object.fromEntries(TIPI.map((t) => [t, righe.filter((f) => f.tipo === t)
    .map(({ percorso, nome, mime, dimensione, caricato_il }) => ({ percorso, nome, mime, dimensione, caricato_il }))]));
}

export function rotteMateriale(app: Hono<{ Bindings: Env }>, now: () => Date) {
  app.get("/api/file", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM file ORDER BY percorso").all<RigaFile>()).results));

  app.put("/api/file/:p{.+}", async (c) => {
    const percorso = c.req.param("p");
    const p = leggiPercorso(percorso);
    if (!p) return c.json({ errore: "Percorso non ammesso: <Materia>/<schede|fonti|appunti>/<nome> (pdf, md, txt, png, jpg, webp)" }, 400);
    const dati = await c.req.arrayBuffer();
    if (dati.byteLength > MAX_FILE) return c.json({ errore: "File troppo grande (max 25 MB)" }, 413);
    const sha256 = esadecimale(await crypto.subtle.digest("SHA-256", dati));
    const db = c.env.DB;
    const pezzi = [];
    for (let n = 0; n * PEZZO < Math.max(dati.byteLength, 1); n++) {
      pezzi.push(db.prepare("INSERT INTO file_pezzi (percorso, n, dati) VALUES (?, ?, ?)").bind(percorso, n, dati.slice(n * PEZZO, (n + 1) * PEZZO)));
    }
    // batch = una transazione: chi legge vede il file vecchio o quello nuovo, mai a metà
    await db.batch([
      db.prepare("DELETE FROM file_pezzi WHERE percorso = ?").bind(percorso),
      ...pezzi,
      db.prepare(`INSERT INTO file (percorso, materia, tipo, nome, mime, dimensione, sha256, caricato_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(percorso) DO UPDATE SET mime = excluded.mime, dimensione = excluded.dimensione, sha256 = excluded.sha256, caricato_il = excluded.caricato_il`)
        .bind(percorso, p.materia, p.tipo, p.nome, p.mime, dati.byteLength, sha256, now().toISOString()),
    ]);
    return c.json({ percorso, sha256 }, 201);
  });

  app.get("/api/file/:p{.+}", async (c) => {
    const db = c.env.DB;
    const f = await db.prepare("SELECT * FROM file WHERE percorso = ?").bind(c.req.param("p")).first<RigaFile>();
    if (!f) return c.json({ errore: "File non trovato" }, 404);
    const pezzi = (await db.prepare("SELECT dati FROM file_pezzi WHERE percorso = ? ORDER BY n").bind(f.percorso).all<{ dati: ArrayBuffer | number[] }>()).results;
    const corpo = new Uint8Array(f.dimensione);
    let da = 0;
    for (const { dati } of pezzi) {
      const b = new Uint8Array(dati);
      corpo.set(b, da);
      da += b.length;
    }
    return new Response(corpo, {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.nome)}`,
        "Cache-Control": "private, no-cache",
        ETag: `"${f.sha256}"`,
        "Content-Security-Policy": CSP_FILE,
      },
    });
  });

  app.delete("/api/file/:p{.+}", async (c) => {
    const db = c.env.DB;
    const percorso = c.req.param("p");
    const [, tolto] = await db.batch([
      db.prepare("DELETE FROM file_pezzi WHERE percorso = ?").bind(percorso),
      db.prepare("DELETE FROM file WHERE percorso = ? RETURNING percorso").bind(percorso),
    ]);
    return tolto.results.length ? c.json({ ok: true }) : c.json({ errore: "File non trovato" }, 404);
  });

  // Oggi, finché il tutor non carica il suo, c'è il recap scritto dall'app
  app.get("/api/recap", async (c) => {
    const elenco: { data: string; automatico?: boolean }[] = (await c.env.DB.prepare("SELECT data FROM recap ORDER BY data DESC").all<{ data: string }>()).results;
    const oggi = oggiRoma(now());
    return c.json(elenco.some((r) => r.data === oggi) ? elenco : [{ data: oggi, automatico: true }, ...elenco.filter((r) => r.data < oggi)]);
  });

  app.get("/api/recap/:data", async (c) => {
    const data = c.req.param("data");
    const r = await c.env.DB.prepare("SELECT data, testo, caricato_il FROM recap WHERE data = ?").bind(data).first();
    if (r) return c.json(r);
    if (data === oggiRoma(now())) return c.json({ data, testo: await recapAutomatico(c.env.DB, now()), caricato_il: null, automatico: true });
    return c.json({ errore: "Recap non trovato" }, 404);
  });

  app.put("/api/recap/:data", async (c) => {
    const data = c.req.param("data");
    const testo = await c.req.text();
    if (!DATA.test(data) || !testo.trim() || testo.length > MAX_RECAP) return c.json({ errore: "Servono una data AAAA-MM-GG e un testo" }, 400);
    await c.env.DB.prepare(`INSERT INTO recap (data, testo, caricato_il) VALUES (?, ?, ?)
      ON CONFLICT(data) DO UPDATE SET testo = excluded.testo, caricato_il = excluded.caricato_il`).bind(data, testo, now().toISOString()).run();
    return c.json({ data }, 201);
  });
}
