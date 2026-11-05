import { vistaLogin } from "./viste/login.js";
import { vistaAgenda } from "./viste/agenda.js";
import { vistaMaterie } from "./viste/materie.js";
import { vistaMateria } from "./viste/materia.js";
import { vistaStudio } from "./viste/studio.js";
import { vistaFile } from "./viste/file.js";
import { vistaRecap } from "./viste/recap.js";
import { vistaOrario } from "./viste/orario.js";

const contenuto = document.getElementById("contenuto");
const barra = document.getElementById("barra");

export class NonLoggato extends Error {}

/** Chiamata alle API. Se la sessione manca mostra il login. */
export async function api(percorso, opzioni = {}) {
  const headers = opzioni.body ? { "Content-Type": "application/json" } : {};
  const r = await fetch(percorso, { credentials: "same-origin", headers, ...opzioni });
  if (r.status === 401 && percorso !== "/api/login") throw new NonLoggato();
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dati.errore || `Errore ${r.status}`), { stato: r.status });
  return dati;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function mostra() {
  const [sezione, ...resto] = location.hash.replace(/^#\/?/, "").split("/");
  const attiva = sezione === "file" ? "materie" : sezione || "agenda";
  for (const a of barra.querySelectorAll("a")) a.classList.toggle("attiva", a.dataset.sezione === attiva);
  try {
    barra.hidden = false;
    if (sezione === "materie" && resto.length) await vistaMateria(contenuto, decodeURIComponent(resto.join("/")));
    else if (sezione === "materie") await vistaMaterie(contenuto);
    else if (sezione === "file") await vistaFile(contenuto, decodeURIComponent(resto.join("/")));
    else if (sezione === "studio") await vistaStudio(contenuto);
    else if (sezione === "orario") await vistaOrario(contenuto);
    else if (sezione === "recap") await vistaRecap(contenuto, resto[0]);
    else await vistaAgenda(contenuto);
  } catch (e) {
    if (e instanceof NonLoggato) {
      barra.hidden = true;
      vistaLogin(contenuto, mostra);
    } else {
      contenuto.innerHTML = `<p class="avviso">Qualcosa è andato storto: ${esc(e.message)}</p>`;
    }
  }
}

addEventListener("hashchange", mostra);
mostra();
