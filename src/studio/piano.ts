import { aggiungiGiorni, giornoIso } from "../registro/date";
import { type Orario, stessaMateria } from "../registro/orario";
import { hhmm, minuti } from "./ore";

export type Intervallo = { inizio: string; fine: string };

export type InputPiano = {
  /** ora di Roma, YYYY-MM-DDTHH:MM */
  adesso: string;
  voci: { id: number; materie: string[]; testo: string; tipo: string; scadenza: string | null }[];
  orario: Orario;
  giorniSenzaScuola: Set<string>;
  /** impegni e blocchi che restano (già con la pausa dopo) */
  occupato: Intervallo[];
  /** sessioni già coperte da blocchi spostati, fatti, eliminati o passati */
  chiaviTenute: Set<string>;
  materieDeboli: string[];
  /** materia → argomenti recenti dal diario delle lezioni */
  argomenti: Record<string, string[]>;
  /** blocchi messi dallo studente: quel giorno quella materia è già coperta */
  tuoi: { giorno: string; materia: string }[];
};

export type BloccoPiano = { chiave: string; materia: string; cosa: string; dettagli: string; voceId: number | null; inizio: string; durata: number };

const ORIZZONTE = 14;
const PAUSA = 10;
const MAX_PESANTE = 30;
const FINE = 19 * 60 + 30;
const SERA = 22 * 60; // un compito per domani, se non c'è altro posto, si fa stasera
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

export const etichetta = (d: string) => `${GIORNI[giornoIso(d) % 7]} ${Number(d.slice(8))}`;

// Studio dopo l'uscita, il pranzo e una pausa; nei giorni senza scuola anche la mattina
function finestre(giorno: string, i: InputPiano): [number, number][] {
  const dow = giornoIso(giorno);
  if (dow === 7 || i.giorniSenzaScuola.has(giorno)) return [[600, 750], [900, FINE]];
  return pesante(giorno, i) ? [[960, FINE]] : [[900, FINE]];
}
const pesante = (giorno: string, i: InputPiano) =>
  giornoIso(giorno) !== 7 && !i.giorniSenzaScuola.has(giorno) && (i.orario.uscita[giornoIso(giorno)] ?? "") >= "14:00";

/** Parti di una sessione: nei giorni pesanti blocchi corti. */
const parti = (durata: number, corti: boolean) => {
  if (!corti) return [durata];
  const p: number[] = [];
  for (let resto = durata; resto > 0; resto -= MAX_PESANTE) p.push(Math.min(MAX_PESANTE, resto));
  return p;
};

type Sessione = { base: string; materia: string; cosa: string; dettagli: string; voceId: number | null; giorni: string[]; durata: number };

export function pianifica(i: InputPiano): { blocchi: BloccoPiano[]; nonCiSta: string[] } {
  const oggi = i.adesso.slice(0, 10);
  const ultimo = aggiungiGiorni(oggi, ORIZZONTE - 1);
  const daOra = Math.ceil(minuti(i.adesso.slice(11)) / 15) * 15;
  const finita = finestre(oggi, i).every(([, a]) => daOra >= a);

  // Occupato per giorno, in minuti dall'inizio del giorno
  const occupato = new Map<string, [number, number][]>();
  const occupa = (g: string, s: number, e: number) => occupato.set(g, [...(occupato.get(g) ?? []), [s, e]]);
  for (const o of i.occupato) {
    for (let g = o.inizio.slice(0, 10); g <= o.fine.slice(0, 10) && g <= ultimo; g = aggiungiGiorni(g, 1)) {
      occupa(g, g === o.inizio.slice(0, 10) ? minuti(o.inizio.slice(11)) : 0, g === o.fine.slice(0, 10) ? minuti(o.fine.slice(11)) : 1440);
    }
  }

  const trova = (g: string, durata: number, occ: [number, number][], sera = false) => {
    for (let [da, a] of sera ? [[FINE, SERA] as [number, number]] : finestre(g, i)) {
      if (g === oggi) da = Math.max(da, daOra);
      const candidati = [da, ...occ.map(([, e]) => Math.ceil(e / 5) * 5)].filter((c) => c >= da).sort((x, y) => x - y);
      const libero = candidati.find((c) => c + durata <= a && occ.every(([s, e]) => c + durata <= s || c >= e));
      if (libero !== undefined) return libero;
    }
    return null;
  };

  // Una sessione divisa in pezzi: ogni pezzo spostato o fatto copre solo sé stesso
  const pezziTenuti = (base: string) => [...i.chiaviTenute].filter((k) => k.startsWith(`${base}:`));

  const sessioni: Sessione[] = [];
  const voci = i.voci.filter((v) => v.scadenza && v.scadenza > oggi && v.scadenza <= aggiungiGiorni(oggi, ORIZZONTE));
  const perScadenza = (a: { scadenza: string | null }, b: { scadenza: string | null }) => a.scadenza!.localeCompare(b.scadenza!);
  const nome = (v: { materie: string[] }) => v.materie.join(" / ") || "Materia?";
  const conArgomenti = (testo: string, materia: string) =>
    [testo, i.argomenti[materia]?.length ? `Argomenti recenti: ${i.argomenti[materia].join("; ")}` : ""].filter(Boolean).join("\n");

  for (const v of voci.filter((v) => v.tipo === "COMPITO").sort(perScadenza)) {
    const giorni: string[] = [];
    for (let g = aggiungiGiorni(v.scadenza!, -1); g >= oggi; g = aggiungiGiorni(g, -1)) giorni.push(g);
    sessioni.push({ base: `v${v.id}`, materia: nome(v), cosa: `Compito per ${etichetta(v.scadenza!)}`, dettagli: v.testo, voceId: v.id, giorni, durata: 45 });
  }
  for (const v of voci.filter((v) => v.tipo !== "COMPITO").sort(perScadenza)) {
    const verifica = v.tipo === "VERIFICA";
    const prova = verifica ? `la verifica di ${etichetta(v.scadenza!)}` : `l'interrogazione di ${etichetta(v.scadenza!)}`;
    for (let k = verifica ? 4 : 3; k >= 1; k--) {
      const g = aggiungiGiorni(v.scadenza!, -k);
      if (g < oggi || (g === oggi && finita)) continue; // la giornata di oggi è già finita: niente da segnalare
      sessioni.push({
        base: `v${v.id}:-${k}`, materia: nome(v), voceId: v.id, giorni: [g],
        cosa: k === 1 ? `Ripasso ${verifica ? "leggero " : ""}per ${prova}` : `Studio per ${prova}`,
        dettagli: conArgomenti(v.testo, v.materie[0]), durata: k === 1 ? 30 : verifica ? 60 : 45,
      });
    }
  }
  for (let g = oggi; g <= ultimo; g = aggiungiGiorni(g, 1)) {
    if (giornoIso(g) !== 3) continue;
    for (const m of i.materieDeboli) {
      sessioni.push({ base: `r${m}:${g}`, materia: m, cosa: "Ripasso (media sotto 6)", dettagli: conArgomenti("", m), voceId: null, giorni: [g], durata: 45 });
    }
  }

  const blocchi: BloccoPiano[] = [];
  const nonCiSta: string[] = [];
  for (const s of sessioni) {
    if (i.chiaviTenute.has(s.base)) continue;
    if (s.giorni.some((g) => i.tuoi.some((t) => t.giorno === g && stessaMateria(t.materia, s.materia)))) continue;
    const tenuti = pezziTenuti(s.base);
    let messa = false;
    const tentativi = s.voceId !== null && s.base === `v${s.voceId}` ? [...s.giorni.map((g) => ({ g, sera: false })), { g: oggi, sera: true }]
      : s.giorni.map((g) => ({ g, sera: false }));
    for (const { g, sera } of tentativi) {
      const occ = [...(occupato.get(g) ?? [])];
      const durate = parti(s.durata, pesante(g, i));
      if (durate.length === 1 && tenuti.length) { messa = true; break; }
      const pezzi = durate
        .map((durata, n) => ({ durata, chiave: durate.length > 1 ? `${s.base}:${n + 1}` : s.base }))
        .filter((p) => !tenuti.includes(p.chiave));
      const posti: BloccoPiano[] = [];
      for (const { durata, chiave } of pezzi) {
        const inizio = trova(g, durata, occ, sera);
        if (inizio === null) break;
        occ.push([inizio, inizio + durata + PAUSA]);
        posti.push({ chiave, materia: s.materia, cosa: s.cosa, dettagli: s.dettagli, voceId: s.voceId, inizio: `${g}T${hhmm(inizio)}`, durata });
      }
      if (posti.length === pezzi.length) {
        occupato.set(g, occ);
        blocchi.push(...posti);
        messa = true;
        break;
      }
    }
    if (!messa) nonCiSta.push(`${s.materia}: ${s.cosa} (${etichetta(s.giorni.at(-1) ?? oggi)})`);
  }
  blocchi.sort((a, b) => a.inizio.localeCompare(b.inizio) || a.chiave.localeCompare(b.chiave));
  return { blocchi, nonCiSta };
}
