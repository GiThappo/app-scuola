/** Date come stringhe YYYY-MM-DD, sempre riferite al giorno di Roma. */

const FORMATO_ROMA = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

export function oggiRoma(now: Date): string {
  return FORMATO_ROMA.format(now);
}

export function aggiungiGiorni(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 1 = lunedì … 7 = domenica. */
export function giornoIso(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
}

/** 1° settembre dell'anno scolastico in corso. */
export function inizioAnnoScolastico(oggi: string): string {
  const anno = Number(oggi.slice(0, 4));
  return `${Number(oggi.slice(5, 7)) >= 9 ? anno : anno - 1}-09-01`;
}
