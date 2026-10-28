import { api, esc } from "../app.js";
import { daQuanto, etichettaGiorno, etichettaBlocco, tonoMateria } from "../formato.js";

const DURATE = [15, 20, 30, 45, 60, 90, 120];
const adessoRoma = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");

const opzioniDurata = (scelta) => [...new Set([...DURATE, scelta])].sort((a, b) => a - b)
  .map((d) => `<option value="${d}" ${d === scelta ? "selected" : ""}>${d} min</option>`).join("");

function campi({ data, ora, durata }) {
  return `
    <label>Giorno <input type="date" name="data" value="${esc(data)}" required></label>
    <label>Ora <input type="time" name="ora" value="${esc(ora)}" step="300" required></label>
    <label>Durata <select name="durata">${opzioniDurata(durata)}</select></label>`;
}

// Righe aperte, così restano aperte quando la pagina si ricarica dopo un'azione
const aperti = new Set();

/** Una riga per blocco: materia, tipo e ora; toccandola si apre con cosa fare. */
function blocco(b, adesso, oggi) {
  const passato = `${b.data}T${b.fine}` <= adesso && !b.fatto;
  const tag = etichettaBlocco(b, oggi);
  const materia = b.materia.split(" / ")[0];
  return `
    <details class="voce blocco ${b.fatto ? "fatto" : ""} ${passato ? "passato" : ""}" data-id="${b.id}" ${aperti.has(String(b.id)) ? "open" : ""}>
      <summary>
        <span class="iniziale piccola tono-${tonoMateria(materia)}">${esc(materia.charAt(0).toUpperCase())}</span>
        <span class="nome">${esc(b.materia)}</span>
        <span class="tag ${esc(tag.classe)}">${esc(tag.testo)}</span>
        <span class="ora">${esc(b.ora)}</span>
        <span class="freccia" aria-hidden="true">›</span>
      </summary>
      <div class="corpo">
        <div class="nota">${esc(b.ora)}–${esc(b.fine)} · ${esc(b.durata)} min${b.fatto ? " · fatto" : ""}</div>
        <div class="cosa">${esc(b.cosa)}</div>
        ${b.dettagli ? `<div class="nota dettagli">${esc(b.dettagli)}</div>` : ""}
        <div class="azioni">
          <a class="bottone piccolo primario" href="#/materie/${encodeURIComponent(materia)}">Vai alla materia ›</a>
          <button class="bottone piccolo" data-azione="fatto">${b.fatto ? "↺ Da fare" : "✓ Fatto"}</button>
          <button class="bottone piccolo" data-azione="sposta">Sposta</button>
          <button class="bottone piccolo" data-azione="elimina" aria-label="Elimina">✕</button>
        </div>
        <form class="modulo" data-modulo="sposta" hidden>
          ${campi(b)}
          <div class="azioni"><button class="bottone primario piccolo">Salva</button><button class="bottone piccolo" type="button" data-azione="annulla">Annulla</button></div>
        </form>
      </div>
    </details>`;
}

/** Blocchi di oggi, per la cima dell'Agenda. */
export function oggiDaStudiare(studio) {
  const oggi = studio.giorni.find((g) => g.data === studio.oggi)?.blocchi.filter((b) => !b.fatto) ?? [];
  if (!oggi.length) return "";
  return `<h2><a href="#/studio">Oggi da studiare ›</a></h2>${oggi.map((b) => `
    <a class="voce" href="#/studio"><div class="ora">${esc(b.ora)}<span>${esc(b.fine)}</span></div>
      <div class="corpo"><b>${esc(b.materia)}</b><div>${esc(b.cosa)}</div></div></a>`).join("")}`;
}

const TOAST_MS = 8000;

/** appenaEliminato: id del blocco appena tolto, per il tasto Annulla. */
export async function vistaStudio(el, { appenaEliminato = null } = {}) {
  const s = await api("/api/studio");
  const adesso = adessoRoma();
  const cal = s.calendario.ultimo_sync
    ? `Google Calendar: sincronizzato ${daQuanto(s.calendario.ultimo_sync)}`
    : "Google Calendar: non ancora collegato";
  const nonCiSta = s.non_ci_sta.length
    ? `<div class="avviso"><b>Non ci sta tutto.</b> Sposta qualcosa o anticipa:<ul>${s.non_ci_sta.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const giorni = s.giorni.length
    ? s.giorni.map((g) => `<h2>${esc(etichettaGiorno(g.data, s.oggi))}</h2>${g.blocchi.map((b) => blocco(b, adesso, s.oggi)).join("")}`).join("")
    : `<p class="vuoto">Niente da studiare nei prossimi 14 giorni. Le verifiche e i compiti del registro compaiono qui da soli.</p>`;

  const eliminati = s.eliminati.length
    ? `<details class="eliminati"><summary>Eliminati (${s.eliminati.length})</summary>${s.eliminati.map((b) => `
        <div class="voce" data-id="${b.id}">
          <div class="ora">${esc(b.ora)}<span>${esc(b.fine)}</span></div>
          <div class="corpo"><b>${esc(b.materia)}</b> · ${esc(etichettaGiorno(b.data, s.oggi))}<div class="nota">${esc(b.cosa)}</div></div>
          <button class="bottone piccolo" data-azione="ripristina">Ripristina</button>
        </div>`).join("")}</details>` : "";
  const toast = appenaEliminato
    ? `<div class="toast" data-id="${appenaEliminato}">Eliminato <button class="bottone piccolo" data-azione="ripristina">Annulla</button></div>` : "";

  // Un contenitore nuovo a ogni giro, così gli ascoltatori non si accumulano su el
  el.innerHTML = `<div id="studio">
    <div class="testa">
      <div><h1>Studio</h1><div class="sotto">${esc(cal)}</div></div>
      <button class="bottone" id="nuovo">＋ Aggiungi</button>
    </div>
    <form class="voce modulo" data-modulo="nuovo" hidden>
      <label>Materia <input name="materia" list="materie" required maxlength="60"></label>
      <datalist id="materie">${s.materie.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <label>Cosa <input name="cosa" required maxlength="200" placeholder="es. esercizi pag. 80"></label>
      ${campi({ data: s.oggi, ora: "16:00", durata: 30 })}
      <div class="azioni"><button class="bottone primario piccolo">Aggiungi</button><button class="bottone piccolo" type="button" data-azione="annulla">Annulla</button></div>
      <p class="errore"></p>
    </form>
    ${nonCiSta}${giorni}${eliminati}
    <p class="nota">I blocchi che sposti o aggiungi diventano <b>tuoi</b>: il piano automatico non li tocca e organizza il resto intorno.</p>${toast}</div>`;
  const radice = el.querySelector("#studio");
  for (const d of radice.querySelectorAll("details.blocco")) {
    d.addEventListener("toggle", () => (d.open ? aperti.add(d.dataset.id) : aperti.delete(d.dataset.id)));
  }

  const ricarica = (opzioni) => vistaStudio(el, opzioni);
  setTimeout(() => radice.querySelector(".toast")?.remove(), TOAST_MS);
  const valori = (form) => {
    const f = new FormData(form);
    return { ...Object.fromEntries(f), durata: Number(f.get("durata")) };
  };
  const nuovo = radice.querySelector('[data-modulo="nuovo"]');
  radice.querySelector("#nuovo").addEventListener("click", () => { nuovo.hidden = false; nuovo.querySelector("input").focus(); });

  radice.addEventListener("click", async (e) => {
    const bottone = e.target.closest("[data-azione]");
    if (!bottone) return;
    const riga = bottone.closest("[data-id]");
    const azione = bottone.dataset.azione;
    if (azione === "annulla") { bottone.closest("form").hidden = true; return; }
    if (azione === "sposta") { riga.querySelector('[data-modulo="sposta"]').hidden = false; return; }
    bottone.disabled = true;
    if (azione === "fatto") await api(`/api/studio/${riga.dataset.id}`, { method: "PATCH", body: JSON.stringify({ fatto: !riga.classList.contains("fatto") }) });
    if (azione === "ripristina") await api(`/api/studio/${riga.dataset.id}/ripristina`, { method: "POST" });
    if (azione === "elimina") {
      aperti.delete(riga.dataset.id);
      await api(`/api/studio/${riga.dataset.id}`, { method: "DELETE" });
      return ricarica({ appenaEliminato: riga.dataset.id });
    }
    await ricarica();
  });

  radice.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    form.querySelector("button").disabled = true;
    try {
      if (form.dataset.modulo === "nuovo") await api("/api/studio", { method: "POST", body: JSON.stringify(valori(form)) });
      else await api(`/api/studio/${form.closest("[data-id]").dataset.id}`, { method: "PATCH", body: JSON.stringify(valori(form)) });
      await ricarica();
    } catch (err) {
      form.querySelector("button").disabled = false;
      const p = form.querySelector(".errore") ?? form.appendChild(Object.assign(document.createElement("p"), { className: "errore" }));
      p.textContent = err.message;
    }
  });
}
