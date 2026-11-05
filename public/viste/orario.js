import { api, esc } from "../app.js";
import { oreLezioni, tonoMateria } from "../formato.js";
import { markdown } from "../markdown.js";

const NOMI = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

export async function vistaOrario(el) {
  const { oggi, giorni, note } = await api("/api/orario");
  if (!giorni.length) {
    el.innerHTML = `<h1>Orario</h1><p class="vuoto">Orario non ancora caricato: dal PC lancia <code>scripts/carica-orario.sh orario.md</code>.</p>`;
    return;
  }
  const isoOggi = new Date(`${oggi}T12:00:00Z`).getUTCDay() || 7;
  const isoDomani = (isoOggi % 7) + 1;

  el.innerHTML = `
    <h1>Orario</h1>
    ${giorni.map((g) => {
      const quando = g.giorno === isoOggi ? "Oggi" : g.giorno === isoDomani ? "Domani" : "";
      const inizi = oreLezioni(g.uscita, g.ore.length);
      return `
      <section class="voce giorno-orario${quando === "Oggi" ? " oggi" : ""}" id="giorno-${g.giorno}">
        <div class="corpo">
          <div class="testa-giorno">
            <b>${NOMI[g.giorno]}</b>${quando ? ` <span class="tag OGGI">${quando}</span>` : ""}
            <span class="nota">${[g.uscita && `uscita ${esc(g.uscita)}`, g.giornata && esc(g.giornata)].filter(Boolean).join(" · ")}</span>
          </div>
          <ol class="ore-lezione">
            ${g.ore.map((m, i) => `
              <li><span class="ora">${inizi[i] || `${i + 1}ª`}</span><span class="pallino tono-${tonoMateria(m)}"></span><span>${esc(m)}</span></li>`).join("")}
          </ol>
        </div>
      </section>`;
    }).join("")}
    ${note ? `<details class="eliminati"><summary>Regole per lo studio</summary><article class="scheda">${markdown(note)}</article></details>` : ""}`;
  document.getElementById(`giorno-${isoOggi === 7 ? 1 : isoOggi}`)?.scrollIntoView({ block: "start" });
}
