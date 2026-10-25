import { giornoIso } from "./date";
import { type Orario, haMateria, nomeBreve } from "./orario";

export type TipoVoce = "COMPITO" | "VERIFICA" | "INTERROGAZIONE";

export type VoceAgenda = {
  id: number;
  data: string;
  materie: string[];
  testo: string;
  tipo: TipoVoce;
  scadenza: string | null;
  dedotta: boolean;
};

const PAROLE_PROVA = /verific|interrog|compito in classe|test\b|prova\b/i;

export function classificaTipo(testo: string): TipoVoce {
  if (!PAROLE_PROVA.test(testo)) return "COMPITO";
  return /interrog/i.test(testo) ? "INTERROGAZIONE" : "VERIFICA";
}

/** Materie di una voce di agenda: quella del registro, oppure quelle del docente che ha lezione quel giorno. */
export function materieVoce(
  e: { subjectDesc: string | null; authorName: string; evtDatetimeBegin: string },
  docenteMaterie: Map<string, string[]>,
  orario: Orario,
): string[] {
  if (e.subjectDesc) return [nomeBreve(e.subjectDesc)];
  const candidate = docenteMaterie.get(e.authorName) ?? [];
  const giorno = giornoIso(e.evtDatetimeBegin.slice(0, 10));
  const quelGiorno = candidate.filter((m) => haMateria(orario, giorno, m));
  return quelGiorno.length ? quelGiorno : candidate;
}

const NOMI_GIORNI = "lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica";

/** Data scritta nel testo ("per il 28/10", "entro lunedì 26"), la prima possibile dalla data della voce in poi. */
function dataEsplicita(testo: string, da: string): string | null {
  const [anno, mese] = da.split("-").map(Number);
  const dopo = (d: string) => (d >= da ? d : null);
  const fmt = (a: number, m: number, g: number) => `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;

  const conMese = testo.match(/\b(?:entro|per)\s+(?:il\s+)?(\d{1,2})\/(\d{1,2})\b/i);
  if (conMese) {
    const g = Number(conMese[1]);
    const m = Number(conMese[2]);
    return dopo(fmt(anno, m, g)) ?? fmt(anno + 1, m, g);
  }
  const conGiorno = testo.match(new RegExp(`\\b(?:entro|per)\\s+(?:il\\s+)?(?:${NOMI_GIORNI})\\s+(\\d{1,2})\\b`, "i"));
  if (conGiorno) {
    const g = Number(conGiorno[1]);
    return dopo(fmt(anno, mese, g)) ?? (mese === 12 ? fmt(anno + 1, 1, g) : fmt(anno, mese + 1, g));
  }
  return null;
}

/**
 * Scadenza di una voce. Data esplicita nel testo > data della voce: in questa classe i prof
 * datano la voce al giorno in cui il compito va consegnato o c'è la prova (non al giorno in cui la scrivono).
 */
export function scadenza(voce: { data: string; testo: string }): { scadenza: string; dedotta: boolean } {
  return { scadenza: dataEsplicita(voce.testo, voce.data) ?? voce.data, dedotta: false };
}
