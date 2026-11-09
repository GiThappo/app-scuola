import type { Hono } from "hono";
import { ErroreClasseviva, scaricaAllegato } from "../classeviva/client";
import type { Env } from "./aggiorna";
import { CSP_FILE } from "../materiale/api";
import { leggiCredenziali } from "./credenziali";

type Riga = {
  id: number; codice: string; titolo: string; categoria: string; data: string; letta: number; valida: number; allegati: string;
  vista: number; riguarda: string | null; destinatari: string | null; riassunto: string | null; da_fare: string | null;
};
type Allegato = { n: number; nome: string };

const RIGUARDA = ["si", "forse", "no"];
const MAX_RIASSUNTO = 2000;
const MAX_DA_FARE = 1000;
const MAX_DESTINATARI = 200;

/** Le copie protocollate ("annotazione_...") ripetono il documento: allo studente non servono. */
const diServizio = (nome: string) => /^annotazione_/i.test(nome);

/** Nel dubbio, o senza riassunto, una circolare resta da leggere: "non ti riguarda" deve essere sicuro. */
function gruppo(r: Riga) {
  if (r.riassunto == null) return "da_leggere";
  return r.riguarda === "si" ? "ti_riguardano" : r.riguarda === "no" ? "non_ti_riguardano" : "da_leggere";
}

const voce = (r: Riga) => ({
  id: r.id, titolo: r.titolo, categoria: r.categoria, data: r.data, letta: !!r.letta, valida: !!r.valida, vista: !!r.vista,
  allegati: (JSON.parse(r.allegati) as Allegato[]).filter((a) => !diServizio(a.nome)),
  riguarda: r.riguarda, destinatari: r.destinatari, riassunto: r.riassunto, da_fare: r.da_fare, gruppo: gruppo(r),
});

/** Allinea le circolari a quelle di Classeviva, senza toccare ciò che appartiene all'app (vista e riassunto). */
export function istruzioniBacheca(db: D1Database, items: any[], adesso: string): D1PreparedStatement[] {
  const attive = items.filter((v) => v.cntStatus !== "deleted");
  return [
    db.prepare("DELETE FROM bacheca WHERE id NOT IN (SELECT value FROM json_each(?))").bind(JSON.stringify(attive.map((v) => v.pubId))),
    ...attive.map((v) => db.prepare(
      `INSERT INTO bacheca (id, codice, titolo, categoria, data, letta, valida, allegati, vista, visto_il) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?6, ?9)
       ON CONFLICT(id) DO UPDATE SET codice = excluded.codice, titolo = excluded.titolo, categoria = excluded.categoria, data = excluded.data,
         letta = excluded.letta, valida = excluded.valida, allegati = excluded.allegati`,
    ).bind(
      v.pubId, v.evtCode, String(v.cntTitle ?? "").trim(), v.cntCategory ?? "", String(v.pubDT).slice(0, 10), v.readStatus ? 1 : 0, v.cntValidInRange ? 1 : 0,
      JSON.stringify((v.attachments ?? []).map((a: any) => ({ n: a.attachNum, nome: a.fileName }))), adesso,
    )),
  ];
}

export function rotteBacheca(app: Hono<{ Bindings: Env }>, fetchFn?: typeof fetch) {
  const riga = (db: D1Database, id: string) => db.prepare("SELECT * FROM bacheca WHERE id = ?").bind(Number(id)).first<Riga>();

  app.get("/api/bacheca", async (c) => {
    const righe = (await c.env.DB.prepare("SELECT * FROM bacheca ORDER BY data DESC, id DESC").all<Riga>()).results;
    return c.json({ voci: righe.map(voce) });
  });

  app.put("/api/bacheca/:id/riassunto", async (c) => {
    const b = (await c.req.json().catch(() => null)) as any;
    const testo = typeof b?.riassunto === "string" ? b.riassunto.trim() : "";
    const destinatari = typeof b?.destinatari === "string" ? b.destinatari.trim() : "";
    const daFare = typeof b?.da_fare === "string" ? b.da_fare.trim() : "";
    if (!RIGUARDA.includes(b?.riguarda) || !testo || testo.length > MAX_RIASSUNTO || destinatari.length > MAX_DESTINATARI || daFare.length > MAX_DA_FARE) {
      return c.json({ errore: "Servono riguarda (si, forse o no) e un riassunto non troppo lungo" }, 400);
    }
    // "vista" vale solo al primo caricamento: ricaricare un riassunto corretto non rimette in evidenza la circolare
    const { meta } = await c.env.DB.prepare(
      `UPDATE bacheca SET riguarda = ?1, destinatari = ?2, riassunto = ?3, da_fare = ?4,
         vista = CASE WHEN riassunto IS NULL AND ?5 IS NOT NULL THEN ?5 ELSE vista END WHERE id = ?6`,
    ).bind(b.riguarda, destinatari, testo, daFare, typeof b.vista === "boolean" ? (b.vista ? 1 : 0) : null, Number(c.req.param("id"))).run();
    return meta.changes ? c.json({ ok: true }) : c.json({ errore: "Circolare non trovata" }, 404);
  });

  app.patch("/api/bacheca/:id", async (c) => {
    const b = (await c.req.json().catch(() => null)) as any;
    if (typeof b?.vista !== "boolean") return c.json({ errore: "Serve vista: true o false" }, 400);
    const { meta } = await c.env.DB.prepare("UPDATE bacheca SET vista = ? WHERE id = ?").bind(b.vista ? 1 : 0, Number(c.req.param("id"))).run();
    return meta.changes ? c.json({ ok: true }) : c.json({ errore: "Circolare non trovata" }, 404);
  });

  // Risponde con testo semplice: si apre in una scheda nuova, dove un JSON non direbbe niente
  app.get("/api/bacheca/:id/allegato/:n", async (c) => {
    const r = await riga(c.env.DB, c.req.param("id"));
    const allegato = r && (JSON.parse(r.allegati) as Allegato[]).find((a) => a.n === Number(c.req.param("n")));
    if (!r || !allegato) return c.text("Allegato non trovato", 404);
    const credenziali = await leggiCredenziali(c.env);
    if (!credenziali) return c.text("Collega Classeviva per aprire gli allegati", 409);
    let dati: ArrayBuffer;
    try {
      dati = await scaricaAllegato(credenziali.utente, credenziali.password, r.codice, r.id, allegato.n, fetchFn);
    } catch (e) {
      console.error("allegato", e instanceof Error ? e.message : e);
      return c.text(e instanceof ErroreClasseviva ? "Classeviva non ha dato il documento. Riprova tra poco" : "Non riesco a collegarmi a Classeviva. Riprova tra poco", 502);
    }
    await c.env.DB.prepare("UPDATE bacheca SET letta = 1, vista = 1 WHERE id = ?").bind(r.id).run();
    // Solo i PDF si aprono nella pagina: gli altri file vengono dalla scuola e non vanno interpretati dal browser
    const pdf = /\.pdf$/i.test(allegato.nome);
    return new Response(dati, {
      headers: {
        "Content-Type": pdf ? "application/pdf" : "application/octet-stream",
        "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(allegato.nome)}`,
        "Cache-Control": "private, no-store",
        ...(pdf ? { "Content-Security-Policy": CSP_FILE } : {}),
      },
    });
  });
}
