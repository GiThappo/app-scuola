import { api, esc } from "../app.js";

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const giorno = (d) => `${Number(d.slice(8, 10))} ${MESI[Number(d.slice(5, 7)) - 1]}`;
const SEZIONI = [["ti_riguardano", "Ti riguardano"], ["da_leggere", "Da leggere"], ["non_ti_riguardano", "Non ti riguardano"]];

function etichetta(v) {
  if (v.riassunto == null) return `<span class="tag ATTESA">Riassunto in arrivo</span>`;
  const testo = v.destinatari || { si: "Ti riguarda", forse: "Da controllare", no: "Altre classi" }[v.riguarda];
  return `<span class="tag RIGUARDA-${esc(v.riguarda)}">${esc(testo)}</span>`;
}

function collegamenti(v) {
  return v.allegati.map((a, i) => {
    const nome = i === 0 ? (/\.pdf$/i.test(a.nome) ? "Apri il PDF" : "Scarica il documento") : `Allegato ${i + 1}`;
    return `<a class="apri" href="/api/bacheca/${v.id}/allegato/${a.n}" target="_blank" rel="noopener" data-vista="${v.id}">${nome}</a>`;
  }).join("");
}

function circolare(v) {
  const stato = [giorno(v.data), v.letta ? "" : "non letta", v.valida ? "" : "scaduta"].filter(Boolean).join(" · ");
  const inAttesa = v.riassunto == null ? `<div class="nota">Lo scrive il tutor la prossima volta che lo lanci.</div>` : "";
  const dettagli = v.gruppo === "non_ti_riguardano" ? "" : `
    ${v.riassunto ? `<div class="riassunto">${esc(v.riassunto)}</div>` : inAttesa}
    ${v.da_fare ? `<div class="da-fare">Da fare: ${esc(v.da_fare)}</div>` : ""}`;
  return `
    <article class="voce circolare ${v.vista ? "" : "da-vedere"} ${v.gruppo === "non_ti_riguardano" ? "spenta" : ""}" id="circolare-${v.id}">
      <div class="corpo">
        <div class="nota">${esc(stato)}</div>
        <b>${esc(v.titolo)}</b>
        <div>${etichetta(v)}</div>
        ${dettagli}
        <div class="azioni">
          ${collegamenti(v)}
          ${v.vista ? "" : `<button class="bottone piccolo" data-segna="${v.id}">Vista</button>`}
        </div>
      </div>
    </article>`;
}

const togliEvidenza = (id) => {
  const c = document.getElementById(`circolare-${id}`);
  c?.classList.remove("da-vedere");
  c?.querySelector("[data-segna]")?.remove();
};

export async function vistaBacheca(el) {
  const { voci } = await api("/api/bacheca");
  const sezioni = SEZIONI.map(([chiave, titolo]) => {
    const del = voci.filter((v) => v.gruppo === chiave);
    return del.length ? `<h2>${titolo}</h2>${del.map(circolare).join("")}` : "";
  }).join("");
  el.innerHTML = `<div id="bacheca"><h1>Bacheca</h1>${sezioni || `<p class="vuoto">Nessuna circolare per ora.</p>`}</div>`;
  // Sul contenitore della vista, che sparisce con lei: su `el` i listener si sommerebbero a ogni apertura
  el.querySelector("#bacheca").addEventListener("click", async (e) => {
    const apri = e.target.closest("[data-vista]");
    if (apri) return togliEvidenza(apri.dataset.vista);
    const segna = e.target.closest("[data-segna]");
    if (!segna) return;
    segna.disabled = true;
    try {
      await api(`/api/bacheca/${segna.dataset.segna}`, { method: "PATCH", body: JSON.stringify({ vista: true }) });
      togliEvidenza(segna.dataset.segna);
    } catch {
      segna.disabled = false;
    }
  });
}
