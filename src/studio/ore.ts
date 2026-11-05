/** Orari "locali" di Roma come stringhe YYYY-MM-DDTHH:MM (si confrontano come stringhe). */

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function localeRoma(d: Date): string {
  const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Ora di Roma → ISO UTC. Si corregge lo scarto finché l'ora di Roma torna (due giri bastano anche col cambio d'ora). */
export function utcDaRoma(locale: string): string {
  const voluto = Date.parse(`${locale}:00Z`);
  let t = voluto;
  for (let i = 0; i < 2; i++) t += voluto - Date.parse(`${localeRoma(new Date(t))}:00Z`);
  return new Date(t).toISOString();
}

export const minuti = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Minuti tra due orari locali. */
export const durataTra = (inizio: string, fine: string) => (Date.parse(`${fine}:00Z`) - Date.parse(`${inizio}:00Z`)) / 60000;

/** Orario locale + minuti. */
export const piuMinuti = (locale: string, m: number) => new Date(Date.parse(`${locale}:00Z`) + m * 60000).toISOString().slice(0, 16);
