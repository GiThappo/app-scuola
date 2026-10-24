import { api, esc } from "../app.js";

export async function vistaMaterie(el) {
  const materie = await api("/api/materie");
  el.innerHTML = `
    <h1>Materie</h1>
    <div class="lista">
      ${materie.map((m) => `
        <a class="voce" href="#/materie/${encodeURIComponent(m.nome)}">
          <span>${esc(m.nome)}</span>
          <span class="media ${m.sotto_sei ? "basso" : ""}">${m.media == null ? "—" : m.media.toFixed(2).replace(".", ",")}</span>
        </a>`).join("") || `<p class="vuoto">Ancora nessun dato: premi Aggiorna nell'Agenda.</p>`}
    </div>`;
}
