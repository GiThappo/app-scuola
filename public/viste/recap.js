import { api, esc } from "../app.js";
import { etichettaGiorno, recapHtml } from "../formato.js";

export async function vistaRecap(el, data) {
  const elenco = await api("/api/recap");
  if (!elenco.length) {
    el.innerHTML = `<h1>Recap</h1><p class="vuoto">Ancora nessun recap: lo carica il tutor dal PC quando scrive il report del giorno.</p>`;
    return;
  }
  const scelto = data && elenco.some((r) => r.data === data) ? data : elenco[0].data;
  const recap = await api(`/api/recap/${scelto}`);
  const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const i = elenco.findIndex((r) => r.data === scelto);
  const freccia = (r, segno, etichetta) => r
    ? `<a class="bottone piccolo" href="#/recap/${r.data}" aria-label="${etichetta}">${segno}</a>`
    : `<span class="bottone piccolo" aria-hidden="true" style="visibility:hidden">${segno}</span>`;

  el.innerHTML = `
    <div class="testa">
      <h1>Recap</h1>
      <div class="azioni">${freccia(elenco[i + 1], "‹", "Giorno prima")}${freccia(elenco[i - 1], "›", "Giorno dopo")}</div>
    </div>
    <div class="sotto">${esc(etichettaGiorno(scelto, oggi))}${recap.automatico ? " · scritto dall'app, il tutor non l'ha ancora mandato" : ""}</div>
    <article class="recap">${recapHtml(recap.testo)}</article>
    <details class="eliminati"><summary>Tutti i recap (${elenco.length})</summary>
      <div class="lista">${elenco.map((r) => `<a class="voce" href="#/recap/${r.data}">${esc(etichettaGiorno(r.data, oggi))}</a>`).join("")}</div>
    </details>`;
  scrollTo(0, 0);
}
