// Formattazione di date e orari per l'interfaccia (fuso di Roma).

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

const parti = (d) => {
  const [a, m, g] = d.split("-").map(Number);
  return { m, g, dow: new Date(Date.UTC(a, m - 1, g)).getUTCDay() };
};
const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const piuUno = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const ROMA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function roma(date) {
  const p = Object.fromEntries(ROMA.formatToParts(date).map((x) => [x.type, x.value]));
  return { giorno: `${p.year}-${p.month}-${p.day}`, ora: `${p.hour}:${p.minute}`, dm: `${Number(p.day)}/${p.month}` };
}

/** "Domani · sab 24", "Lun 26", "Lun 2 nov" (mese solo se diverso da quello di oggi). */
export function etichettaGiorno(data, oggi) {
  const d = parti(data);
  const base = `${GIORNI[d.dow]} ${d.g}`;
  if (data === oggi) return `Oggi · ${base}`;
  if (data === piuUno(oggi)) return `Domani · ${base}`;
  return maiuscola(d.m === parti(oggi).m ? base : `${base} ${MESI[d.m - 1]}`);
}

/** "adesso", "5 min fa", "2 ore fa", "ieri alle 18:00", "il 20/10 alle 09:30". */
export function daQuanto(iso, now = new Date()) {
  const quando = new Date(iso);
  const sec = (now.getTime() - quando.getTime()) / 1000;
  const q = roma(quando);
  const n = roma(now);
  if (sec < 60) return "adesso";
  if (q.giorno === n.giorno) {
    if (sec < 3600) return `${Math.floor(sec / 60)} min fa`;
    const ore = Math.floor(sec / 3600);
    return ore === 1 ? "1 ora fa" : `${ore} ore fa`;
  }
  if (piuUno(q.giorno) === n.giorno) return `ieri alle ${q.ora}`;
  return `il ${q.dm} alle ${q.ora}`;
}
