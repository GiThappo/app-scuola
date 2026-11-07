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

/**
 * Testi delle liste vuote. Una lista vuota vuol dire "non c'è niente" solo se il registro è stato controllato:
 * mai scaricato → non lo sappiamo; ultimo aggiornamento fallito → valeva all'ultimo controllo riuscito.
 */
export function messaggiVuoto({ ultimo_ok, ultimo_errore }, now = new Date(), { avviso = true } = {}) {
  if (!ultimo_ok) {
    const perche = "il registro non è ancora stato scaricato.";
    return {
      domani: `Non so ancora cosa c'è per domani: ${perche}`,
      avanti: `Non so ancora cosa c'è nei prossimi giorni: ${perche}`,
      studio: `Non so ancora cosa c'è da studiare: ${perche}`,
    };
  }
  if (ultimo_errore && avviso) {
    const allora = `all'ultimo controllo riuscito (${daQuanto(ultimo_ok, now)}), ma potrebbe essere cambiato qualcosa.`;
    return {
      domani: `Niente per domani ${allora}`,
      avanti: `Niente nei prossimi giorni ${allora}`,
      studio: `Niente da studiare ${allora}`,
    };
  }
  return {
    domani: "Niente sul registro per domani.",
    avanti: "Niente più avanti nei prossimi 30 giorni.",
    studio: "Niente da studiare nei prossimi 14 giorni. Le verifiche e i compiti del registro compaiono qui da soli.",
  };
}

const ORE_DATI_RECENTI = 6;

/** L'errore si mostra se serve: password da correggere, dati vecchi o mai scaricati, oppure se lo studente ha appena provato ad aggiornare. */
export function avvisoAggiornamento({ ultimo_errore, ultimo_ok, classeviva }, now = new Date(), { appenaProvato = false } = {}) {
  if (!ultimo_errore) return false;
  if (appenaProvato || classeviva !== "ok" || !ultimo_ok) return true;
  return now.getTime() - Date.parse(ultimo_ok) > ORE_DATI_RECENTI * 3600 * 1000;
}

export const PREFISSO_TELEFONO = "dal telefono ";

/** Dove salvare un file caricato dall'app. Data e ora evitano che "image.jpg" sostituisca la foto precedente; il prefisso lo protegge dalla sincronizzazione dal PC. */
export function percorsoCaricamento(materia, nome, adesso = new Date()) {
  const pulito = (s) => s.replace(/[/\\]/g, " ").trim();
  const r = roma(adesso);
  const secondi = String(adesso.getUTCSeconds()).padStart(2, "0");
  return `${pulito(materia)}/appunti/${PREFISSO_TELEFONO}${r.giorno} ${r.ora.replace(":", ".")}.${secondi} ${pulito(nome)}`;
}

/** Etichetta del blocco di studio: i compiti per domani si vedono subito. */
export function etichettaBlocco(b, oggi) {
  if (b.tipo === "COMPITO") return b.scadenza === piuUno(oggi) ? { testo: "PER DOMANI", classe: "DOMANI" } : { testo: "COMPITO", classe: "COMPITO" };
  if (b.tipo === "INTERROGAZIONE") return { testo: "INTERROG.", classe: "INTERROGAZIONE" };
  return { testo: b.tipo || "STUDIO", classe: b.tipo || "STUDIO" };
}

/** Classe per il colore della media: rosso sotto il 6, giallo fino al 7, verde dall'8. */
export const classeMedia = (m) => (m == null ? "" : m < 6 ? "basso" : m < 7 ? "medio" : m >= 8 ? "alto" : "");
/** Colore stabile per ogni materia, da 0 a 7, ricavato dal nome. */
export const tonoMateria = (nome) => [...String(nome).toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 8, 7); // 8 colori in stile.css (la CSP non permette style inline)

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Recap del tutor (testo a colonne pensato per il PC) → HTML leggibile sul telefono. */
export function recapHtml(testo) {
  const righe = String(testo ?? "").replace(/\r\n?/g, "\n").split("\n");
  return righe.map((r, i) => {
    if (!r.trim()) return "";
    const rientro = r.match(/^ */)[0].length;
    const pulita = escHtml(r.trim().replace(/\s+\.{3,}\s+/g, ": ").replace(/\s{2,}/g, " · "));
    if (i === 0) return `<p class="r-titolo">${pulita}</p>`;
    if (!rientro && /^\d+\.\s/.test(r)) return `<h3>${pulita}</h3>`;
    return `<p class="r${Math.min(2, Math.floor(rientro / 3))}">${pulita}</p>`;
  }).join("");
}

/** Inizio di ogni ora di lezione, contando a ritroso dall'uscita (lezioni da 1 ora): "13:00", 5 → ["8:00", …, "12:00"]. */
export function oreLezioni(uscita, n) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(uscita ?? "");
  if (!m) return Array(n).fill("");
  const fine = Number(m[1]) * 60 + Number(m[2]);
  return Array.from({ length: n }, (_, i) => {
    const t = fine - (n - i) * 60;
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  });
}
