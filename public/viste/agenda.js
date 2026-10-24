import { api, esc } from "../app.js";
import { daQuanto, etichettaGiorno } from "../formato.js";
import { oggiDaStudiare } from "./studio.js";

const ETICHETTE = { VERIFICA: "VERIFICA", INTERROGAZIONE: "INTERROGAZIONE", COMPITO: "COMPITO" };
const UN_ORA = 3600 * 1000;
const domani = (oggi) => new Date(Date.parse(`${oggi}T12:00:00Z`) + 24 * UN_ORA).toISOString().slice(0, 10);
const titolo = (oggi) => {
  const s = etichettaGiorno(oggi, oggi).replace("Oggi · ", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function voce(v, oggi) {
  const scadenza = v.dedotta && v.scadenza ? `<div class="nota">per ${esc(etichettaGiorno(v.scadenza, oggi).toLowerCase())} · prossima lezione</div>` : "";
  return `
    <div class="voce">
      <span class="tag ${esc(v.tipo)}">${esc(ETICHETTE[v.tipo] ?? v.tipo)}</span>
      <div class="corpo">
        <b class="${v.nuova ? "nuovo" : ""}">${esc(v.materie.join(" / ") || "Materia?")}</b>
        <div>${esc(v.testo)}</div>${scadenza}
        ${v.tua ? `<div class="nota">aggiunta da te</div><div class="azioni"><button class="bottone piccolo" data-elimina="${esc(v.id)}">Elimina</button></div>` : ""}
      </div>
    </div>`;
}

export async function vistaAgenda(el) {
  const [stato, agenda, studio] = await Promise.all([api("/api/stato"), api("/api/agenda"), api("/api/studio")]);
  const oggi = stato.oggi;
  const ultimo = stato.ultimo_ok ? `Aggiornato ${daQuanto(stato.ultimo_ok)}` : "Mai aggiornato";
  const errore = stato.ultimo_errore
    ? `<p class="avviso">Ultimo aggiornamento non riuscito ${esc(daQuanto(stato.ultimo_tentativo))}: ${esc(stato.ultimo_errore)}.
       ${stato.ultimo_ok ? `Vedi i dati di ${esc(daQuanto(stato.ultimo_ok))}.` : ""}</p>`
    : "";
  const promemoria = agenda.promemoria.map((m) => `<p class="avviso">${esc(m)} domani: hai compiti? La prof non li scrive sul registro.</p>`).join("");
  const giorni = agenda.giorni.length
    ? agenda.giorni.map((g) => `<h2>${esc(etichettaGiorno(g.data, oggi))}</h2>${g.voci.map((v) => voce(v, oggi)).join("")}`).join("")
    : `<p class="vuoto">Niente in programma nei prossimi 30 giorni.</p>`;
  const daControllare = agenda.da_controllare.length
    ? `<h2>Data da controllare</h2>${agenda.da_controllare.map((v) => voce(v, oggi)).join("")}` : "";
  const senzaVoto = agenda.senza_voto.length
    ? `<h2>In attesa di voto</h2>${agenda.senza_voto.map((s) =>
        `<div class="voce"><div class="corpo"><b>${esc(s.materia)}</b> · ${esc(etichettaGiorno(s.data, oggi))}<div class="nota">${esc(s.testo)}</div></div></div>`).join("")}` : "";

  el.innerHTML = `
    <div class="testa">
      <div><h1>${esc(titolo(oggi))}</h1><div class="sotto">${esc(ultimo)}</div></div>
      <div class="azioni"><button class="bottone" id="nuova">＋ Verifica</button><button class="bottone" id="aggiorna">⟳ Aggiorna</button></div>
    </div>
    <form class="voce modulo" id="modulo-verifica" hidden>
      <label>Materia <input name="materia" list="materie" required maxlength="60"></label>
      <datalist id="materie">${agenda.materie.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <label>Giorno <input type="date" name="data" value="${esc(domani(oggi))}" min="${esc(oggi)}" required></label>
      <label>Argomenti <textarea name="testo" maxlength="1000" rows="3" placeholder="es. Medioevo, pag. 10-40"></textarea></label>
      <div class="azioni"><button class="bottone primario piccolo">Aggiungi verifica</button><button class="bottone piccolo" type="button" id="annulla">Annulla</button></div>
      <p class="errore"></p>
    </form>
    ${errore}${promemoria}${oggiDaStudiare(studio)}${giorni}${daControllare}${senzaVoto}`;

  const modulo = el.querySelector("#modulo-verifica");
  el.querySelector("#nuova").addEventListener("click", () => { modulo.hidden = false; modulo.querySelector("input").focus(); });
  el.querySelector("#annulla").addEventListener("click", () => { modulo.hidden = true; });
  modulo.addEventListener("submit", async (e) => {
    e.preventDefault();
    modulo.querySelector("button").disabled = true;
    try {
      await api("/api/agenda", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(modulo))) });
      await vistaAgenda(el);
    } catch (err) {
      modulo.querySelector("button").disabled = false;
      modulo.querySelector(".errore").textContent = err.message;
    }
  });
  for (const b of el.querySelectorAll("[data-elimina]")) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      await api(`/api/agenda/${b.dataset.elimina}`, { method: "DELETE" });
      await vistaAgenda(el);
    });
  }

  const bottone = el.querySelector("#aggiorna");
  const aggiorna = async () => {
    bottone.disabled = true;
    bottone.innerHTML = `<span class="gira">⟳</span> Aggiorno…`;
    try {
      await api("/api/aggiorna", { method: "POST" });
    } catch (e) {
      if (e.stato !== 429) throw e;
    }
    await vistaAgenda(el);
  };
  bottone.addEventListener("click", aggiorna);
  if (!stato.ultimo_ok || Date.now() - Date.parse(stato.ultimo_ok) > UN_ORA) {
    if (!stato.ultimo_tentativo || Date.now() - Date.parse(stato.ultimo_tentativo) > 60 * 1000) aggiorna();
  }
}
