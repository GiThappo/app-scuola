/** Voce di `grades` di Classeviva (solo i campi usati). */
export type VotoCV = {
  evtId: number;
  evtDate: string;
  subjectDesc: string;
  displayValue: string;
  decimalValue: number | null;
  weightFactor: number | null;
  canceled: boolean;
  noAverage: boolean;
  componentDesc: string;
  periodPos: number;
  periodLabel: string;
  notesForFamily: string;
};

const MODIFICATORI: Record<string, number> = { "+": 0.25, "-": -0.25, "½": 0.5, "1/2": 0.5 };

/** Converte un voto in numero ("6+" -> 6.25, "6½" -> 6.5). null se non fa media. */
export function valore(v: VotoCV): number | null {
  if (v.canceled || v.noAverage) return null;
  if (v.decimalValue != null) return v.decimalValue;
  const m = (v.displayValue ?? "").trim().match(/^(\d+)\s*(\+|-|½|1\/2)?$/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? MODIFICATORI[m[2]] : 0);
}

/** Media pesata con weightFactor (null = 1), arrotondata a 2 decimali. */
export function media(voti: VotoCV[]): number | null {
  let somma = 0;
  let pesi = 0;
  for (const v of voti) {
    const n = valore(v);
    if (n == null) continue;
    const p = v.weightFactor ?? 1;
    somma += n * p;
    pesi += p;
  }
  return pesi ? Math.round((somma / pesi) * 100) / 100 : null;
}
