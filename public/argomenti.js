// Sezione Argomenti della pagina materia: ogni argomento è una riga che si apre
// con il super riassunto e il pulsante del PDF. Solo funzioni pure (i test girano senza DOM).
import { markdown } from "./markdown.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const urlFile = (percorso) => `/api/file/${percorso.split("/").map(encodeURIComponent).join("/")}`;

/** La riga toccabile; il corpo (riassunto + PDF) va dentro .argomento-corpo quando si apre. */
export function rigaArgomento(a, indice, aperto) {
  return `
    <div class="argomento${aperto ? " aperto" : ""}">
      <button class="voce argomento-riga" data-argomento="${indice}" aria-expanded="${aperto}">
        <span class="tipo-file ${a.pdf ? "PDF" : "MD"}">${a.pdf ? "PDF" : "MD"}</span>
        <span class="corpo">${esc(a.titolo)}</span>
        <span class="freccia" aria-hidden="true">›</span>
      </button>
      <div class="argomento-corpo"${aperto ? "" : " hidden"}></div>
    </div>`;
}

export function corpoArgomento(a, testoRiassunto, { errore = false } = {}) {
  const riassunto = errore
    ? `<p class="vuoto">Il riassunto non si è caricato: chiudi e riapri la riga per riprovare.</p>`
    : testoRiassunto == null ? "" : `<article class="scheda riassunto">${markdown(testoRiassunto)}</article>`;
  const pdf = a.pdf ? `<a class="bottone primario" href="${urlFile(a.pdf)}" target="_blank" rel="noopener">Apri il PDF</a>` : "";
  return riassunto + pdf;
}
