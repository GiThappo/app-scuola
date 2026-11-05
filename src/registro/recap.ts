import { aggiungiGiorni, giornoIso, oggiRoma } from "./date";
import { haMateria, parseOrario } from "./orario";
import { etichetta } from "../studio/piano";
import { localeRoma } from "../studio/ore";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNO_MS = 24 * 3600 * 1000;
const SETTIMANA_MS = 7 * GIORNO_MS;

type Voce = { id: number; materie: string; testo: string; tipo: string; scadenza: string | null; visto_il: string };
type Voto = { materia: string; voto: string; valore: number | null; peso: number; tipo: string; visto_il: string };

const virgola = (n: number) => n.toFixed(2).replace(".", ",");
const materieDi = (v: Voce) => (JSON.parse(v.materie) as string[]).join(" / ") || "Materia?";
const tipo = (t: string) => t.toLowerCase();
const media = (voti: Voto[]) => {
  const validi = voti.filter((v) => v.valore != null);
  const pesi = validi.reduce((s, v) => s + v.peso, 0);
  return pesi ? validi.reduce((s, v) => s + v.valore! * v.peso, 0) / pesi : null;
};
const sezione = (titolo: string, righe: string[], vuoto: string) => [titolo, ...(righe.length ? righe : [vuoto]).map((r) => `   ${r}`)];

/**
 * Recap di oggi scritto dall'app con i dati del registro, nello stesso formato del report del tutor
 * (titolo, sezioni "1. ...", righe rientrate). Quello del tutor, quando arriva, prende il suo posto.
 */
export async function recapAutomatico(db: D1Database, now: Date): Promise<string> {
  const oggi = oggiRoma(now);
  const domani = aggiungiGiorni(oggi, 1);
  const recente = (iso: string, ms = GIORNO_MS) => now.getTime() - new Date(iso).getTime() < ms;
  const [voci, voti, medie, blocchi, imp, giornoDomani] = await db.batch([
    db.prepare("SELECT id, materie, testo, tipo, scadenza, visto_il FROM agenda WHERE scadenza >= ? ORDER BY scadenza, id").bind(oggi),
    db.prepare("SELECT materia, voto, valore, peso, tipo, visto_il FROM voti ORDER BY data, id"),
    db.prepare("SELECT materia, media FROM medie"),
    db.prepare("SELECT materia, cosa, inizio, fatto FROM blocchi WHERE eliminato = 0 AND inizio >= ? AND inizio < ? ORDER BY inizio").bind(oggi, domani),
    db.prepare("SELECT valore FROM impostazioni WHERE chiave = 'orario_md'"),
    db.prepare("SELECT scuola FROM giorni WHERE data = ?").bind(domani),
  ]);
  const agenda = voci.results as Voce[];
  const tuttiVoti = voti.results as Voto[];
  const cv = new Map((medie.results as { materia: string; media: number | null }[]).map((m) => [m.materia, m.media]));

  const novita = [
    ...tuttiVoti.filter((v) => recente(v.visto_il)).map((v) => `Voto nuovo: ${v.materia} ${v.voto}${v.tipo ? ` (${v.tipo})` : ""}${v.valore == null ? ", non fa media" : ""}`),
    ...agenda.filter((v) => v.id > 0 && recente(v.visto_il))
      .map((v) => `Nuovo in agenda: ${materieDi(v)}, ${tipo(v.tipo)} per ${etichetta(v.scadenza!)}`),
  ];

  const orario = parseOrario((imp.results[0] as { valore: string } | undefined)?.valore ?? "");
  const scuolaDomani = (giornoDomani.results[0] as { scuola: number } | undefined)?.scuola !== 0;
  const perDomani = [
    ...agenda.filter((v) => v.scadenza === domani).map((v) => `${materieDi(v)}, ${tipo(v.tipo)}: ${v.testo}`),
    ...(scuolaDomani ? orario.senzaRegistro.filter((m) => haMateria(orario, giornoIso(domani), m)) : [])
      .map((m) => `${m}: controlla se ci sono compiti, non li scrive sul registro`),
  ];

  const prove = agenda.filter((v) => v.tipo !== "COMPITO" && v.scadenza! > oggi && v.scadenza! <= aggiungiGiorni(oggi, 14))
    .map((v) => `${etichetta(v.scadenza!)} · ${materieDi(v)}, ${tipo(v.tipo)}: ${v.testo}`);

  // Media di Classeviva quando c'è; la freccia confronta con la media senza i voti arrivati nell'ultima settimana
  const materie = [...new Set([...tuttiVoti.map((v) => v.materia), ...cv.keys()])].sort((a, b) => a.localeCompare(b));
  const righeMedie = materie.flatMap((m) => {
    const suoi = tuttiVoti.filter((v) => v.materia === m);
    const ora = cv.has(m) ? cv.get(m)! : media(suoi);
    if (ora == null) return [];
    const prima = media(suoi.filter((v) => !recente(v.visto_il, SETTIMANA_MS)));
    const freccia = prima == null || Math.abs(ora - prima) < 0.01 ? "" : ora > prima ? " ↑" : " ↓";
    return [`${m}: ${virgola(ora)}${freccia}${ora < 6 ? " · sotto il 6" : ""}`];
  });

  const adesso = localeRoma(now);
  const studio = (blocchi.results as { materia: string; cosa: string; inizio: string; fatto: number }[])
    .map((b) => `${b.inizio.slice(11)} ${b.materia}: ${b.cosa}${b.fatto ? " (fatto)" : b.inizio < adesso ? " (da recuperare)" : ""}`);

  const [, mese, giorno] = oggi.split("-").map(Number);
  return [
    `RECAP DI ${etichetta(oggi).split(" ")[0].toUpperCase()} ${giorno} ${MESI[mese - 1].toUpperCase()} · scritto dall'app`,
    "",
    ...sezione("1. NOVITÀ DAL REGISTRO", novita, "Nessuna novità nelle ultime 24 ore"),
    ...sezione("2. PER DOMANI", perDomani, "Niente sul registro"),
    ...sezione("3. VERIFICHE E INTERROGAZIONI IN ARRIVO", prove, "Nessuna nei prossimi 14 giorni"),
    ...sezione("4. MEDIE", righeMedie, "Ancora nessun voto"),
    ...sezione("5. OGGI DA STUDIARE", studio, "Nessun blocco di studio oggi"),
    "",
    "Il report completo lo scrive il tutor con /registro-giornaliero: quando arriva prende il posto di questo.",
  ].join("\n");
}
