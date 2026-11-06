import { giornoIso } from "./date";

export type Orario = {
  /** giorno ISO (1 = lunedì … 6 = sabato) → materie per ora, nomi come nell'orario */
  giorni: Record<number, string[]>;
  uscita: Record<number, string>;
  /** "pesante" / "leggera", come scritto nella colonna Giornata */
  giornata: Record<number, string>;
  senzaRegistro: string[];
  /** le sezioni "## ..." sotto la tabella (regole per lo studio), in Markdown */
  note: string;
};

const GIORNI: Record<string, number> = { lunedì: 1, martedì: 2, mercoledì: 3, giovedì: 4, venerdì: 5, sabato: 6, domenica: 7 };

// Nomi di Classeviva → nomi brevi (come CARTELLE in lezioni.py)
const NOMI_BREVI: Record<string, string> = {
  "LINGUA E LETTERATURA ITALIANA": "Italiano",
  "STORIA": "Storia",
  "LINGUA INGLESE": "Inglese",
  "MATEMATICA E COMPLEMENTI DI MATEMATICA": "Matematica",
  "INFORMATICA": "Informatica",
  "SISTEMI E RETI": "Sistemi e reti",
  "TELECOMUNICAZIONI": "Telecomunicazioni",
  "TECNOLOGIE E PROGETTAZIONE DI SISTEMI INFORMATICI E DI TELECOMUNICAZIONI": "TPSIT",
  "SCIENZE MOTORIE E SPORTIVE": "Scienze motorie",
  "RELIGIONE CATTOLICA  O ATTIVITA' ALTERNATIVE": "Religione",
  "EDUCAZIONE CIVICA": "Educazione civica",
};

// Nomi diversi per la stessa materia tra registro e orario
const ALIAS: Record<string, string> = { "educazione fisica": "scienze motorie" };

export function nomeBreve(subjectDesc: string): string {
  const breve = NOMI_BREVI[subjectDesc];
  if (breve) return breve;
  const s = subjectDesc.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function stessaMateria(a: string, b: string): boolean {
  const norm = (x: string) => {
    const s = x.trim().toLowerCase();
    return ALIAS[s] ?? s;
  };
  return norm(a) === norm(b);
}

export function haMateria(orario: Orario, giorno: number, materia: string): boolean {
  return (orario.giorni[giorno] ?? []).some((m) => stessaMateria(m, materia));
}

const VOCE_SENZA_REGISTRO = /^\s*-\s*([^:]+):/;
const celle = (riga: string) => riga.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Legge la prima tabella Markdown dell'orario e la sezione "Materie che non usano il registro". */
export function parseOrario(md: string): Orario {
  const orario: Orario = { giorni: {}, uscita: {}, giornata: {}, senzaRegistro: [], note: "" };
  const righe = md.split("\n");
  const inizio = righe.findIndex((r) => r.trim().startsWith("|"));
  if (inizio >= 0) {
    const intestazione = celle(righe[inizio]);
    const colOre = intestazione.flatMap((c, i) => (/^\d+\s*ª$/.test(c) ? [i] : []));
    const colUscita = intestazione.findIndex((c) => c.toLowerCase() === "uscita");
    const colGiornata = intestazione.findIndex((c) => c.toLowerCase() === "giornata");
    for (const riga of righe.slice(inizio + 2)) {
      if (!riga.trim().startsWith("|")) break;
      const c = celle(riga);
      const giorno = GIORNI[c[0].toLowerCase()];
      if (!giorno) continue;
      orario.giorni[giorno] = colOre.map((i) => c[i]).filter(Boolean);
      if (colUscita >= 0 && c[colUscita]) orario.uscita[giorno] = c[colUscita];
      if (colGiornata >= 0 && /\p{L}/u.test(c[colGiornata] ?? "")) orario.giornata[giorno] = c[colGiornata];
    }
  }
  const primaSezione = md.search(/^## /m);
  if (primaSezione >= 0) orario.note = md.slice(primaSezione).trim();
  const sezione = md.split(/^## /m).find((s) => s.toLowerCase().startsWith("materie che non usano il registro"));
  for (const r of sezione?.split("\n").slice(1) ?? []) {
    const m = r.match(VOCE_SENZA_REGISTRO);
    if (m) orario.senzaRegistro.push(m[1].trim());
  }
  return orario;
}

export type GiornoOrario = { giorno: number; ore: string[]; uscita: string | null; giornata: string | null };

const NOMI_GIORNI = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const TITOLO_SENZA_REGISTRO = "## Materie che non usano il registro";

function tabellaOrario(giorni: GiornoOrario[]): string[] {
  const ordinati = [...giorni].sort((a, b) => a.giorno - b.giorno);
  const n = Math.max(1, ...ordinati.map((g) => g.ore.length));
  const riga = (c: string[]) => `| ${c.join(" | ")} |`;
  const ore = Array.from({ length: n }, (_, i) => `${i + 1}ª`);
  return [
    riga(["Giorno", ...ore, "Uscita", "Giornata"]),
    `|${"---|".repeat(n + 3)}`,
    ...ordinati.map((g) => riga([
      NOMI_GIORNI[g.giorno], ...Array.from({ length: n }, (_, i) => g.ore[i] ?? ""), g.uscita ?? "", g.giornata ?? "—",
    ])),
  ];
}

/** Aggiorna solo le voci della sezione: i testi delle materie che restano e tutto il resto del file non cambiano. */
function conSenzaRegistro(righe: string[], materie: string[]): string[] {
  const inizio = righe.findIndex((r) => r.trim().toLowerCase() === TITOLO_SENZA_REGISTRO.toLowerCase());
  const voce = (m: string, esistenti: string[]) =>
    esistenti.find((r) => stessaMateria(r.match(VOCE_SENZA_REGISTRO)?.[1] ?? "", m))
    ?? `- ${m}: i compiti non finiscono sul registro. Il giorno prima te li chiedo.`;
  if (inizio < 0) return materie.length ? [...righe, "", TITOLO_SENZA_REGISTRO, "", ...materie.map((m) => voce(m, []))] : righe;

  const dopo = righe.findIndex((r, i) => i > inizio && r.startsWith("## "));
  const fine = dopo < 0 ? righe.length : dopo;
  const corpo = righe.slice(inizio + 1, fine);
  const voci = corpo.filter((r) => VOCE_SENZA_REGISTRO.test(r));
  const testo = corpo.filter((r) => r.trim() && !VOCE_SENZA_REGISTRO.test(r));
  const sezione = !materie.length && !testo.length
    ? []
    : [righe[inizio], "", ...(testo.length ? [...testo, ""] : []), ...materie.map((m) => voce(m, voci)), ""];
  return [...righe.slice(0, inizio), ...sezione, ...righe.slice(fine)];
}

/** Riscrive tabella e materie senza registro nel Markdown dell'orario. Titolo, regole per lo studio e note restano come sono. */
export function scriviOrario(md: string, giorni: GiornoOrario[], senzaRegistro: string[]): string {
  const righe = md.trim() ? md.split("\n") : ["# Orario scolastico", ""];
  const tabella = tabellaOrario(giorni);
  const inizio = righe.findIndex((r) => r.trim().startsWith("|"));
  if (inizio >= 0) {
    const dopo = righe.findIndex((r, i) => i > inizio && !r.trim().startsWith("|"));
    righe.splice(inizio, (dopo < 0 ? righe.length : dopo) - inizio, ...tabella);
  } else {
    const sezione = righe.findIndex((r) => r.startsWith("## "));
    righe.splice(sezione < 0 ? righe.length : sezione, 0, ...tabella, "");
  }
  return `${conSenzaRegistro(righe, senzaRegistro).join("\n").trim()}\n`;
}

/** Orario ricostruito dalle lezioni: per ogni giorno da lunedì a sabato e ogni ora, la materia più frequente. Va controllato. */
export function propostaOrario(lezioni: { data: string; ora: number | null; materia: string }[]): GiornoOrario[] {
  const conteggi = new Map<number, Map<number, Map<string, number>>>();
  for (const { data, ora, materia } of lezioni) {
    const giorno = giornoIso(data);
    if (ora == null || giorno === 7) continue;
    const ore = conteggi.get(giorno) ?? new Map<number, Map<string, number>>();
    const materie = ore.get(ora) ?? new Map<string, number>();
    materie.set(materia, (materie.get(materia) ?? 0) + 1);
    conteggi.set(giorno, ore.set(ora, materie));
  }
  return [...conteggi].sort(([a], [b]) => a - b).map(([giorno, ore]) => ({
    giorno,
    ore: [...ore].sort(([a], [b]) => a - b).map(([, materie]) => [...materie].sort((a, b) => b[1] - a[1])[0][0]),
    uscita: null,
    giornata: null,
  }));
}

const VIETATI = /[|:\r\n]/;
const nomeValido = (s: unknown): s is string => typeof s === "string" && s.trim().length <= 60 && !VIETATI.test(s);

/** Controlla l'orario inviato dall'app e lo normalizza. Se qualcosa non va restituisce il messaggio da mostrare. */
export function leggiOrarioInviato(corpo: unknown): { giorni: GiornoOrario[]; senzaRegistro: string[] } | string {
  const { giorni, senza_registro: senza = [] } = (corpo ?? {}) as { giorni?: unknown; senza_registro?: unknown };
  if (!Array.isArray(giorni)) return "Orario non valido";
  if (!Array.isArray(senza) || !senza.every(nomeValido)) return "Materie senza registro non valide";
  const visti = new Set<number>();
  const letti: GiornoOrario[] = [];
  for (const g of giorni as Partial<GiornoOrario>[]) {
    const { giorno, ore, uscita, giornata } = g ?? {};
    if (!Number.isInteger(giorno) || giorno! < 1 || giorno! > 7 || visti.has(giorno!)) return "Giorno non valido";
    visti.add(giorno!);
    const nome = NOMI_GIORNI[giorno!];
    if (!Array.isArray(ore) || ore.length > 12) return `${nome}: puoi inserire al massimo 12 ore`;
    if (!ore.every(nomeValido)) return `${nome}: il nome di una materia non può contenere i simboli | e : e può avere al massimo 60 caratteri`;
    const ora = /^(\d{1,2}):(\d{2})$/.exec(uscita ?? "");
    if (uscita && (!ora || Number(ora[1]) > 23 || Number(ora[2]) > 59)) return `${nome}: l'ora di uscita non è valida`;
    if (giornata && (typeof giornata !== "string" || giornata.length > 20 || VIETATI.test(giornata))) return `${nome}: tipo di giornata non valido`;
    const materie = ore.map((m) => m.trim()).filter(Boolean);
    if (materie.length) {
      letti.push({ giorno: giorno!, ore: materie, uscita: ora ? `${ora[1].padStart(2, "0")}:${ora[2]}` : null, giornata: giornata || null });
    }
  }
  if (!letti.length) return "Inserisci almeno una materia";
  return { giorni: letti, senzaRegistro: [...new Set((senza as string[]).map((m) => m.trim()).filter(Boolean))] };
}
