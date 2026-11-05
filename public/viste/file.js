import { NonLoggato, esc } from "../app.js";
import { markdown } from "../markdown.js";

export const urlFile = (percorso) => `/api/file/${percorso.split("/").map(encodeURIComponent).join("/")}`;
/** Schede e appunti si leggono dentro l'app; PDF e immagini li apre il browser. */
export const dentroApp = (f) => /^text\//.test(f.mime);
export const titoloFile = (nome) => nome.replace(/\.(md|txt)$/i, "");

export async function vistaFile(el, percorso) {
  const r = await fetch(urlFile(percorso), { credentials: "same-origin" });
  if (r.status === 401) throw new NonLoggato();
  if (!r.ok) throw new Error(r.status === 404 ? "File non trovato" : `Errore ${r.status}`);
  const testo = await r.text();
  const [materia, , nome] = percorso.split("/");
  const md = (r.headers.get("Content-Type") ?? "").startsWith("text/markdown");
  el.innerHTML = `
    <div class="testa"><h1><a href="#/materie/${encodeURIComponent(materia)}" aria-label="Indietro">‹</a> ${esc(titoloFile(nome))}</h1></div>
    <div class="sotto">${esc(materia)}</div>
    <article class="scheda">${md ? markdown(testo) : `<pre class="testo">${esc(testo)}</pre>`}</article>`;
  scrollTo(0, 0);
}
