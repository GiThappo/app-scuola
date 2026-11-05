import { api, esc } from "../app.js";
import { classeMedia, tonoMateria } from "../formato.js";

export async function vistaMaterie(el) {
  const materie = await api("/api/materie");
  el.innerHTML = `
    <h1>Materie</h1>
    <div class="lista">
      ${materie.map((m) => `
        <a class="voce" href="#/materie/${encodeURIComponent(m.nome)}">
          <span class="iniziale tono-${tonoMateria(m.nome)}">${esc(m.nome.charAt(0).toUpperCase())}</span>
          <span class="nome">${esc(m.nome)}</span>
          <span class="media ${classeMedia(m.media)}">${m.media == null ? "—" : m.media.toFixed(2).replace(".", ",")}</span>
        </a>`).join("") || `<p class="vuoto">Ancora nessun dato: premi Aggiorna nell'Agenda.</p>`}
    </div>`;
}
