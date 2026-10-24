import type { Hono, MiddlewareHandler } from "hono";
import type { Env } from "../registro/aggiorna";
import { aggiungiGiorni } from "../registro/date";
import { durataTra, localeRoma, piuMinuti, utcDaRoma } from "./ore";
import { type RigaBlocco, ripianifica } from "./ripianifica";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const durataValida = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 5 && (d as number) <= 240;
/** "[Scuola] Mate – compiti pag. 59" → materia "Matematica" (tra quelle note), cosa "compiti pag. 59". */
export function daTitolo(titolo: string, note: string[]): { materia: string; cosa: string } {
  const senza = titolo.replace(/^\s*(✓\s*)?\[(Tutor|Scuola)\]\s*/, "");
  const m = senza.match(/^(.+?)\s*(?:[:–—]|\s-\s)\s*(.+)$/);
  const [grezza, cosa] = m ? [m[1].trim(), m[2].trim()] : [senza.trim(), senza.trim()];
  const nota = note.find((n) => n.toLowerCase() === grezza.toLowerCase()) ?? note.find((n) => n.toLowerCase().startsWith(grezza.toLowerCase()));
  return { materia: (nota ?? grezza).slice(0, 60) || "Studio", cosa: cosa.slice(0, 200) || "Studio" };
}

const testo = (s: unknown, max: number) => (typeof s === "string" && s.trim() && s.length <= max ? s.trim() : null);

/** Token dello script di Google Calendar, confrontato in tempo costante. */
const richiediToken: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const atteso = c.env.CALENDARIO_TOKEN;
  if (!atteso) return c.json({ errore: "Calendario non configurato" }, 503);
  const dato = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
  const [a, b] = await Promise.all([dato, atteso].map((t) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))));
  if (!crypto.subtle.timingSafeEqual(a, b)) return c.json({ errore: "token sbagliato" }, 401);
  await next();
};

const bloccoApi = (b: RigaBlocco) => ({
  id: b.id, materia: b.materia, cosa: b.cosa, dettagli: b.dettagli, voce_id: b.voce_id,
  data: b.inizio.slice(0, 10), ora: b.inizio.slice(11), fine: piuMinuti(b.inizio, b.durata).slice(11), durata: b.durata,
  fatto: !!b.fatto, tuo: !!b.manuale,
});

export function rotteStudio(app: Hono<{ Bindings: Env }>, now: () => Date) {
  const valore = async (db: D1Database, chiave: string) =>
    (await db.prepare("SELECT valore FROM impostazioni WHERE chiave = ?").bind(chiave).first<{ valore: string | null }>())?.valore ?? null;

  app.get("/api/studio", async (c) => {
    const db = c.env.DB;
    const oggi = localeRoma(now()).slice(0, 10);
    const blocchi = (await db.prepare("SELECT * FROM blocchi WHERE eliminato = 0 AND inizio >= ? ORDER BY inizio, id").bind(oggi).all<RigaBlocco>()).results;
    const giorni = new Map<string, ReturnType<typeof bloccoApi>[]>();
    for (const b of blocchi.map(bloccoApi)) giorni.set(b.data, [...(giorni.get(b.data) ?? []), b]);
    const eliminati = (await db.prepare("SELECT * FROM blocchi WHERE eliminato = 1 AND inizio >= ? ORDER BY inizio, id").bind(oggi).all<RigaBlocco>()).results;
    const materie = (await db.prepare("SELECT DISTINCT materia FROM voti UNION SELECT DISTINCT materia FROM lezioni ORDER BY materia").all<{ materia: string }>()).results;
    return c.json({
      oggi,
      giorni: [...giorni].map(([data, blocchi]) => ({ data, blocchi })),
      eliminati: eliminati.map(bloccoApi),
      non_ci_sta: JSON.parse((await valore(db, "piano_non_ci_sta")) ?? "[]"),
      calendario: { ultimo_sync: await valore(db, "cal_ultimo_sync"), configurato: !!c.env.CALENDARIO_TOKEN },
      materie: materie.map((m) => m.materia),
    });
  });

  app.post("/api/studio", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const materia = testo(b.materia, 60);
    const cosa = testo(b.cosa, 200);
    if (!materia || !cosa || !DATA.test(String(b.data)) || !ORA.test(String(b.ora)) || !durataValida(b.durata)) {
      return c.json({ errore: "Servono materia, cosa, giorno, ora e durata (5–240 minuti)" }, 400);
    }
    const r = await c.env.DB.prepare("INSERT INTO blocchi (materia, cosa, dettagli, inizio, durata, manuale) VALUES (?, ?, ?, ?, ?, 1) RETURNING id")
      .bind(materia, cosa, testo(b.dettagli, 1000) ?? "", `${b.data}T${b.ora}`, b.durata).first<{ id: number }>();
    await ripianifica(c.env.DB, now());
    return c.json({ id: r!.id }, 201);
  });

  app.patch("/api/studio/:id", async (c) => {
    const db = c.env.DB;
    const id = Number(c.req.param("id"));
    const prima = await db.prepare("SELECT * FROM blocchi WHERE id = ? AND eliminato = 0").bind(id).first<RigaBlocco>();
    if (!prima) return c.json({ errore: "Blocco non trovato" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const data = b.data ?? prima.inizio.slice(0, 10);
    const ora = b.ora ?? prima.inizio.slice(11);
    const durata = b.durata ?? prima.durata;
    if (!DATA.test(String(data)) || !ORA.test(String(ora)) || !durataValida(durata) || (b.fatto !== undefined && typeof b.fatto !== "boolean")) {
      return c.json({ errore: "Giorno, ora o durata non validi" }, 400);
    }
    const sposta = b.data !== undefined || b.ora !== undefined || b.durata !== undefined;
    await db.prepare("UPDATE blocchi SET inizio = ?, durata = ?, manuale = ?, fatto = ?, versione = versione + 1 WHERE id = ?")
      .bind(`${data}T${ora}`, durata, sposta ? 1 : prima.manuale, b.fatto === undefined ? prima.fatto : b.fatto ? 1 : 0, id).run();
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  app.delete("/api/studio/:id", async (c) => {
    const db = c.env.DB;
    const id = Number(c.req.param("id"));
    // Restano segnati come eliminati: quelli del piano automatico non tornano da soli, e si possono ripristinare
    await db.prepare("UPDATE blocchi SET eliminato = 1, versione = versione + 1 WHERE id = ?").bind(id).run();
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  app.post("/api/studio/:id/ripristina", async (c) => {
    const db = c.env.DB;
    // Torna dov'era e diventa tuo, così il piano automatico non lo sposta
    const r = await db.prepare("UPDATE blocchi SET eliminato = 0, manuale = 1, versione = versione + 1 WHERE id = ? AND eliminato = 1 RETURNING id")
      .bind(Number(c.req.param("id"))).first();
    if (!r) return c.json({ errore: "Blocco non trovato" }, 404);
    await ripianifica(db, now());
    return c.json({ ok: true });
  });

  app.post("/cal/sync", richiediToken, async (c) => {
    const db = c.env.DB;
    const b = await c.req.json<{ impegni?: unknown; spostati?: unknown; eliminati?: unknown; importa?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const lista = (x: unknown): any[] => (Array.isArray(x) ? x : []);
    const quando = (iso: unknown) => (typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? localeRoma(new Date(iso)) : null);
    const idBlocco = (x: unknown) => (typeof x === "string" && /^b\d+$/.test(x) ? Number(x.slice(1)) : null);

    const s: D1PreparedStatement[] = [db.prepare("DELETE FROM impegni")];
    for (const e of lista(b.impegni)) {
      const [inizio, fine] = [quando(e?.inizio), quando(e?.fine)];
      if (inizio && fine && fine > inizio) {
        s.push(db.prepare("INSERT OR REPLACE INTO impegni (id, titolo, inizio, fine) VALUES (?, ?, ?, ?)").bind(String(e.id).slice(0, 300), String(e.titolo ?? "").slice(0, 200), inizio, fine));
      }
    }
    // Spostati o cancellati dallo studente dentro Calendar
    for (const e of lista(b.spostati)) {
      const [id, inizio, fine] = [idBlocco(e?.id), quando(e?.inizio), quando(e?.fine)];
      const durata = inizio && fine ? durataTra(inizio, fine) : 0;
      if (id && inizio && durataValida(durata)) {
        s.push(db.prepare("UPDATE blocchi SET inizio = ?, durata = ?, manuale = 1, versione = versione + 1 WHERE id = ? AND eliminato = 0").bind(inizio, durata, id));
      }
    }
    for (const x of lista(b.eliminati)) {
      const id = idBlocco(x);
      if (!id) continue;
      s.push(db.prepare("UPDATE blocchi SET eliminato = 1, versione = versione + 1 WHERE id = ?").bind(id));
    }
    s.push(db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('cal_ultimo_sync', ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore")
      .bind(now().toISOString()));
    await db.batch(s);

    // Eventi del piano fatto prima dal tutor: diventano blocchi tuoi, e lo script li adotta invece di fare doppioni
    const adottati: { evento: string; id: string }[] = [];
    const note = (await db.prepare("SELECT DISTINCT materia FROM voti UNION SELECT DISTINCT materia FROM lezioni").all<{ materia: string }>()).results.map((r) => r.materia);
    for (const e of lista(b.importa)) {
      const [inizio, fine] = [quando(e?.inizio), quando(e?.fine)];
      const durata = inizio && fine ? durataTra(inizio, fine) : 0;
      if (typeof e?.evento !== "string" || !inizio || !durataValida(durata)) continue;
      const { materia, cosa } = daTitolo(String(e.titolo ?? ""), note);
      const dettagli = String(e.descrizione ?? "").replace(/\n*Creato dall'agente scolastico\s*$/, "").slice(0, 2000);
      const r = await db.prepare(
        `INSERT INTO blocchi (materia, cosa, dettagli, inizio, durata, manuale, origine) VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(origine) DO UPDATE SET origine = excluded.origine RETURNING id`,
      ).bind(materia, cosa, dettagli, inizio, durata, e.evento.slice(0, 300)).first<{ id: number }>();
      adottati.push({ evento: e.evento, id: `b${r!.id}` });
    }
    await ripianifica(db, now());

    // Finestra che lo script controlla: fuori da qui non tocca niente
    const oggi = localeRoma(now()).slice(0, 10);
    const [da, a] = [aggiungiGiorni(oggi, -7), aggiungiGiorni(oggi, 31)];
    const blocchi = (await db.prepare("SELECT * FROM blocchi WHERE eliminato = 0 AND inizio >= ? AND inizio < ? ORDER BY inizio")
      .bind(da, a).all<RigaBlocco>()).results;
    const prove = (await db.prepare("SELECT id, materie, testo, tipo, scadenza FROM agenda WHERE tipo != 'COMPITO' AND scadenza >= ? AND scadenza < ? ORDER BY scadenza")
      .bind(da, a).all<{ id: number; materie: string; testo: string; tipo: string; scadenza: string }>()).results;
    return c.json({
      adottati,
      da: utcDaRoma(`${da}T00:00`),
      a: utcDaRoma(`${a}T00:00`),
      blocchi: blocchi.map((x) => ({
        id: `b${x.id}`, versione: x.versione,
        titolo: `${x.fatto ? "✓ " : ""}[Tutor] ${x.materia}: ${x.cosa}`,
        descrizione: [x.dettagli, "Dall'app Scuola: puoi spostarlo qui o nell'app."].filter(Boolean).join("\n\n"),
        inizio: utcDaRoma(x.inizio), fine: utcDaRoma(piuMinuti(x.inizio, x.durata)),
      })),
      prove: prove.map((p) => ({
        id: `p${p.id}`, data: p.scadenza,
        titolo: `[Tutor] ${p.tipo} ${(JSON.parse(p.materie) as string[]).join(" / ")}`, descrizione: p.testo,
      })),
    });
  });
}
