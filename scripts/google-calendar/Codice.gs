/**
 * App Scuola ↔ Google Calendar. Gira ogni 5 minuti nel tuo account Google.
 *
 * - Manda all'app i tuoi impegni dei prossimi 14 giorni (solo orari, non i titoli), così il piano li evita.
 * - Scrive nel calendario i blocchi di studio e le verifiche dell'app ("[Tutor] ...").
 * - Se sposti o cancelli qui un blocco "[Tutor]", lo dice all'app.
 * - Gli eventi "[Tutor]" / "[Scuola]" fatti prima dal tutor li adotta: diventano blocchi tuoi nell'app, niente doppioni.
 * Tocca solo gli eventi che ha creato lui (hanno il tag "appScuola"), mai gli altri.
 *
 * Installazione: Impostazioni progetto → Proprietà script: APP_URL e TOKEN. Poi esegui "installa" una volta.
 */

const TAG = "appScuola";
const GIORNO = 24 * 3600 * 1000;

function installa() {
  for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger("sincronizza").timeBased().everyMinutes(5).create();
  sincronizza();
}

function sincronizza() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    sincronizzaOra();
  } finally {
    lock.releaseLock();
  }
}

function sincronizzaOra() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("APP_URL");
  const token = props.getProperty("TOKEN");
  if (!url || !token) throw new Error("Mancano APP_URL o TOKEN nelle proprietà dello script");

  const cal = CalendarApp.getDefaultCalendar();
  const ora = new Date();
  const da = new Date(ora.getTime() - 8 * GIORNO);
  const a = new Date(ora.getTime() + 32 * GIORNO);

  // I nostri eventi e gli impegni veri
  const nostri = {};
  const impegni = [];
  const importa = [];
  const daAdottare = {};
  for (const e of cal.getEvents(da, a)) {
    const id = e.getTag(TAG);
    if (id) {
      nostri[id] = e;
      continue;
    }
    const titolo = e.getTitle();
    const inizio = e.getStartTime();
    if (e.isAllDayEvent()) continue;
    if (e.getEndTime() < ora || inizio.getTime() > ora.getTime() + 14 * GIORNO) continue;
    if (/^\s*(✓\s*)?\[(Tutor|Scuola)\]/.test(titolo)) {
      const chiave = e.getId() + "@" + inizio.getTime();
      daAdottare[chiave] = e;
      importa.push({ evento: chiave, titolo: titolo, descrizione: e.getDescription(), inizio: inizio.toISOString(), fine: e.getEndTime().toISOString() });
      continue;
    }
    if (e.getMyStatus() === CalendarApp.GuestStatus.NO) continue;
    impegni.push({ id: e.getId() + "@" + inizio.getTime(), inizio: inizio.toISOString(), fine: e.getEndTime().toISOString() });
  }

  // Blocchi spostati o cancellati qui dallo studente
  const spostati = [];
  for (const id in nostri) {
    const e = nostri[id];
    if (id.charAt(0) !== "b") continue;
    if (e.getStartTime().toISOString() !== e.getTag("inizio") || e.getEndTime().toISOString() !== e.getTag("fine")) {
      spostati.push({ id: id, inizio: e.getStartTime().toISOString(), fine: e.getEndTime().toISOString() });
    }
  }
  const noti = JSON.parse(props.getProperty("noti") || "{}"); // id blocco → inizio, quelli scritti l'ultima volta
  const eliminati = Object.keys(noti).filter((id) => !nostri[id] && new Date(noti[id]) >= da && new Date(noti[id]) < a);

  const risposta = UrlFetchApp.fetch(url.replace(/\/$/, "") + "/cal/sync", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ impegni: impegni, spostati: spostati, eliminati: eliminati, importa: importa }),
    muteHttpExceptions: true,
  });
  if (risposta.getResponseCode() !== 200) throw new Error("App: " + risposta.getResponseCode() + " " + risposta.getContentText().slice(0, 200));
  const piano = JSON.parse(risposta.getContentText());
  for (const a of piano.adottati || []) {
    const e = daAdottare[a.evento];
    if (!e) continue;
    e.setTag(TAG, a.id);
    nostri[a.id] = e;
  }

  const visti = {};
  const nuoviNoti = {};
  for (const b of piano.blocchi) {
    visti[b.id] = true;
    nuoviNoti[b.id] = b.inizio;
    let e = nostri[b.id];
    const inizio = new Date(b.inizio);
    const fine = new Date(b.fine);
    if (!e) {
      e = cal.createEvent(b.titolo, inizio, fine, { description: b.descrizione });
      e.setTag(TAG, b.id);
    } else if (e.getTag("v") !== String(b.versione) || e.getTitle() !== b.titolo) {
      e.setTime(inizio, fine);
      e.setTitle(b.titolo);
      e.setDescription(b.descrizione);
    } else {
      continue;
    }
    e.setTag("v", String(b.versione));
    e.setTag("inizio", inizio.toISOString());
    e.setTag("fine", fine.toISOString());
  }
  for (const p of piano.prove) {
    visti[p.id] = true;
    const giorno = dataLocale(p.data);
    const e = nostri[p.id];
    if (!e) {
      cal.createAllDayEvent(p.titolo, giorno, { description: p.descrizione }).setTag(TAG, p.id);
      continue;
    }
    if (Utilities.formatDate(e.getAllDayStartDate(), "Europe/Rome", "yyyy-MM-dd") !== p.data) e.setAllDayDate(giorno);
    if (e.getTitle() !== p.titolo) e.setTitle(p.titolo);
    if (e.getDescription() !== p.descrizione) e.setDescription(p.descrizione);
  }

  // Cancella i nostri eventi che l'app non ha più, solo dentro la finestra che l'app ha mandato
  const daApp = new Date(piano.da);
  const aApp = new Date(piano.a);
  for (const id in nostri) {
    const e = nostri[id];
    if (!visti[id] && e.getStartTime() >= daApp && e.getStartTime() < aApp) e.deleteEvent();
  }
  props.setProperty("noti", JSON.stringify(nuoviNoti));
}

function dataLocale(iso) {
  const p = iso.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
