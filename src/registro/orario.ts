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
    const m = r.match(/^\s*-\s*([^:]+):/);
    if (m) orario.senzaRegistro.push(m[1].trim());
  }
  return orario;
}
