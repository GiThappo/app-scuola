import { aggiungiGiorni } from "../registro/date";
import { parseOrario } from "../registro/orario";
import { localeRoma, piuMinuti } from "./ore";
import { pianifica } from "./piano";

export type RigaBlocco = {
  id: number; chiave: string | null; materia: string; cosa: string; dettagli: string; voce_id: number | null;
  inizio: string; durata: number; manuale: number; fatto: number; eliminato: number; versione: number;
};

const PAUSA = 10;
const MAX_ARGOMENTI = 4;

/**
 * Rifà i blocchi automatici futuri intorno a impegni, blocchi spostati a mano, fatti e passati.
 * I blocchi con la stessa chiave si aggiornano invece di essere ricreati, così Calendar non li cancella e ricrea ogni volta.
 */
export async function ripianifica(db: D1Database, now: Date): Promise<void> {
  const adesso = localeRoma(now);
  const oggi = adesso.slice(0, 10);
  const [imp, voci, senzaScuola, impegni, blocchi, deboli, lezioni] = await db.batch([
    db.prepare("SELECT valore FROM impostazioni WHERE chiave = 'orario_md'"),
    db.prepare("SELECT id, materie, testo, tipo, scadenza FROM agenda WHERE scadenza > ? AND scadenza <= ?").bind(oggi, aggiungiGiorni(oggi, 14)),
    db.prepare("SELECT data FROM giorni WHERE scuola = 0 AND data >= ?").bind(oggi),
    db.prepare("SELECT inizio, fine FROM impegni"),
    db.prepare("SELECT * FROM blocchi"),
    db.prepare("SELECT materia FROM voti WHERE valore IS NOT NULL GROUP BY materia HAVING SUM(valore * peso) / SUM(peso) < 6 ORDER BY materia"),
    db.prepare("SELECT materia, argomento, MAX(data) AS d FROM lezioni WHERE data >= ? AND argomento != '' GROUP BY materia, argomento ORDER BY d DESC")
      .bind(aggiungiGiorni(oggi, -21)),
  ]);
  const tutti = blocchi.results as RigaBlocco[];
  const automaticiFuturi = tutti.filter((b) => !b.manuale && !b.fatto && !b.eliminato && b.inizio >= adesso);
  const tenuti = tutti.filter((b) => !automaticiFuturi.includes(b));

  const argomenti: Record<string, string[]> = {};
  for (const l of lezioni.results as { materia: string; argomento: string }[]) {
    if ((argomenti[l.materia] ??= []).length < MAX_ARGOMENTI) argomenti[l.materia].push(l.argomento);
  }

  const piano = pianifica({
    adesso,
    voci: (voci.results as { id: number; materie: string; testo: string; tipo: string; scadenza: string }[]).map((v) => ({ ...v, materie: JSON.parse(v.materie) })),
    orario: parseOrario((imp.results[0] as { valore: string } | undefined)?.valore ?? ""),
    giorniSenzaScuola: new Set((senzaScuola.results as { data: string }[]).map((g) => g.data)),
    occupato: [
      ...(impegni.results as { inizio: string; fine: string }[]),
      ...tenuti.filter((b) => !b.eliminato).map((b) => ({ inizio: b.inizio, fine: piuMinuti(b.inizio, b.durata + PAUSA) })),
    ],
    chiaviTenute: new Set(tenuti.flatMap((b) => (b.chiave ? [b.chiave] : []))),
    materieDeboli: (deboli.results as { materia: string }[]).map((r) => r.materia),
    argomenti,
    tuoi: tenuti.filter((b) => b.manuale && !b.eliminato && !b.chiave).map((b) => ({ giorno: b.inizio.slice(0, 10), materia: b.materia })),
  });

  const s: D1PreparedStatement[] = [];
  const esistenti = new Map(automaticiFuturi.map((b) => [b.chiave, b]));
  for (const b of piano.blocchi) {
    const prima = esistenti.get(b.chiave);
    esistenti.delete(b.chiave);
    if (!prima) {
      s.push(db.prepare("INSERT INTO blocchi (chiave, materia, cosa, dettagli, voce_id, inizio, durata) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(b.chiave, b.materia, b.cosa, b.dettagli, b.voceId, b.inizio, b.durata));
    } else if (prima.inizio !== b.inizio || prima.durata !== b.durata || prima.cosa !== b.cosa || prima.dettagli !== b.dettagli || prima.materia !== b.materia) {
      s.push(db.prepare("UPDATE blocchi SET materia = ?, cosa = ?, dettagli = ?, inizio = ?, durata = ?, versione = versione + 1 WHERE id = ?")
        .bind(b.materia, b.cosa, b.dettagli, b.inizio, b.durata, prima.id));
    }
  }
  for (const b of esistenti.values()) s.push(db.prepare("DELETE FROM blocchi WHERE id = ?").bind(b.id));
  s.push(db.prepare("INSERT INTO impostazioni (chiave, valore) VALUES ('piano_non_ci_sta', ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore")
    .bind(JSON.stringify(piano.nonCiSta)));
  await db.batch(s);
}
