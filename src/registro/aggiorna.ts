import { ErroreClasseviva, scaricaRegistro } from "../classeviva/client";
import { classificaTipo, materieVoce, scadenza } from "./agenda";
import { aggiungiGiorni, oggiRoma } from "./date";
import { nomeBreve, parseOrario } from "./orario";
import { valore } from "./voti";
import { ripianifica } from "../studio/ripianifica";

export type Env = {
  DB: D1Database;
  CLASSEVIVA_UTENTE: string;
  CLASSEVIVA_PASSWORD: string;
  APP_PASSWORD_HASH: string;
  /** token dello script di Google Calendar */
  CALENDARIO_TOKEN?: string;
  ASSETS: Fetcher;
  AGGIORNATORE: DurableObjectNamespace<import("./aggiornatore").Aggiornatore>;
};

const MATERIE_ESCLUSE = new Set(["SOSTEGNO", "SUPPLENZA"]);
const IN_CORSO_MAX_MS = 2 * 60 * 1000;

const salvaImpostazione = (db: D1Database, chiave: string, v: string | null) =>
  db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore").bind(chiave, v);

/** Scarica il registro e lo salva in D1. Se qualcosa va storto, i dati di prima restano. */
export async function aggiorna(env: Env, now: Date, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; errore?: string; inCorso?: boolean }> {
  const db = env.DB;
  const adesso = now.toISOString();
  const oggi = oggiRoma(now);
  // Un aggiornamento alla volta (cron, app aperta su due dispositivi...); dopo 2 minuti si considera bloccato
  const prenotato = await db.prepare(
    `INSERT INTO impostazioni (chiave, valore) VALUES ('in_corso', ?1) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore
     WHERE impostazioni.valore IS NULL OR impostazioni.valore < ?2 RETURNING valore`,
  ).bind(adesso, new Date(now.getTime() - IN_CORSO_MAX_MS).toISOString()).first();
  if (!prenotato) return { ok: false, inCorso: true, errore: "Aggiornamento già in corso" };
  try {
    const dati = await scaricaRegistro(env.CLASSEVIVA_UTENTE, env.CLASSEVIVA_PASSWORD, oggi, fetchFn);
    const orarioMd = (await db.prepare("SELECT valore FROM impostazioni WHERE chiave = 'orario_md'").first<{ valore: string }>())?.valore ?? "";
    const orario = parseOrario(orarioMd);

    const docenteMaterie = new Map<string, string[]>();
    for (const m of dati.materie) {
      if (MATERIE_ESCLUSE.has(m.description)) continue;
      for (const t of m.teachers ?? []) {
        docenteMaterie.set(t.teacherName, [...(docenteMaterie.get(t.teacherName) ?? []), nomeBreve(m.description)]);
      }
    }
    const s: D1PreparedStatement[] = [];

    // Voti: Classeviva dà tutto l'anno, quindi quelli che non ci sono più vanno tolti
    const idVoti = dati.voti.map((v) => v.evtId);
    s.push(db.prepare(`DELETE FROM voti WHERE id NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(idVoti)));
    for (const v of dati.voti) {
      s.push(db.prepare(
        `INSERT INTO voti (id, materia, data, voto, valore, peso, tipo, periodo, nota, visto_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET materia = excluded.materia, data = excluded.data, voto = excluded.voto, valore = excluded.valore,
           peso = excluded.peso, tipo = excluded.tipo, periodo = excluded.periodo, nota = excluded.nota`,
      ).bind(v.evtId, nomeBreve(v.subjectDesc), v.evtDate, v.displayValue, valore(v), v.weightFactor ?? 1, v.componentDesc, v.periodPos, v.notesForFamily ?? "", adesso));
    }

    // Agenda: si toglie solo ciò che è sparito nel periodo scaricato (le voci a mano hanno id negativo e restano)
    const voci = dati.agenda.filter((e) => !MATERIE_ESCLUSE.has(e.subjectDesc));
    s.push(db.prepare(`DELETE FROM agenda WHERE id > 0 AND data BETWEEN ? AND ? AND id NOT IN (SELECT value FROM json_each(?))`)
      .bind(aggiungiGiorni(oggi, -7), aggiungiGiorni(oggi, 30), JSON.stringify(voci.map((e) => e.evtId))));
    for (const e of voci) {
      const data = (e.evtDatetimeBegin as string).slice(0, 10);
      const testo = (e.notes ?? "").trim();
      const materie = materieVoce(e, docenteMaterie, orario);
      const tipo = classificaTipo(testo);
      const sc = scadenza({ data, testo });
      s.push(db.prepare(
        `INSERT INTO agenda (id, data, materie, testo, docente, tipo, scadenza, dedotta, visto_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, materie = excluded.materie, testo = excluded.testo, docente = excluded.docente,
           tipo = excluded.tipo, scadenza = excluded.scadenza, dedotta = excluded.dedotta`,
      ).bind(e.evtId, data, JSON.stringify(materie), testo, e.authorName, tipo, sc.scadenza, sc.dedotta ? 1 : 0, adesso));
    }

    // Lezioni: si rimpiazza il periodo scaricato
    const lezioni = dati.lezioni.filter((l) => !MATERIE_ESCLUSE.has(l.subjectDesc));
    const giorniLezioni = dati.lezioni.map((l) => l.evtDate as string).sort();
    if (giorniLezioni.length) {
      s.push(db.prepare("DELETE FROM lezioni WHERE data BETWEEN ? AND ?").bind(giorniLezioni[0], giorniLezioni.at(-1)));
    }
    for (const l of lezioni) {
      s.push(db.prepare("INSERT OR REPLACE INTO lezioni (id, data, ora, materia, argomento, tipo) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(l.evtId, l.evtDate, l.evtHPos, nomeBreve(l.subjectDesc), (l.lessonArg ?? "").trim(), l.lessonType ?? null));
    }

    for (const c of dati.calendario) {
      s.push(db.prepare("INSERT OR REPLACE INTO giorni (data, scuola) VALUES (?, ?)").bind(c.dayDate, c.dayStatus === "SD" ? 1 : 0));
    }
    s.push(db.prepare("DELETE FROM periodi"));
    for (const p of dati.periodi) {
      s.push(db.prepare("INSERT INTO periodi (pos, nome, inizio, fine) VALUES (?, ?, ?, ?)").bind(p.periodPos, p.periodLabel, p.dateStart, p.dateEnd));
    }

    s.push(salvaImpostazione(db, "ultimo_ok", adesso), salvaImpostazione(db, "ultimo_tentativo", adesso), salvaImpostazione(db, "ultimo_errore", null), salvaImpostazione(db, "in_corso", null));
    await db.batch(s);
    // Il registro è salvato anche se il piano non riesce a rifarsi
    await ripianifica(db, now).catch((e) => console.error("ripianifica", e));
    return { ok: true };
  } catch (e) {
    const errore = e instanceof ErroreClasseviva ? e.message : "Errore imprevisto durante l'aggiornamento";
    if (!(e instanceof ErroreClasseviva)) console.error("aggiorna", e);
    await db.batch([salvaImpostazione(db, "ultimo_tentativo", adesso), salvaImpostazione(db, "ultimo_errore", errore), salvaImpostazione(db, "in_corso", null)]);
    return { ok: false, errore };
  }
}
