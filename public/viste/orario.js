import { api, esc } from "../app.js";
import { oreLezioni, tonoMateria } from "../formato.js";
import { markdown } from "../markdown.js";

const NOMI = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const GIORNATE = [["", "Normale"], ["leggera", "Leggera"], ["pesante", "Pesante"]];

const rigaOra = (nome, materia, i) => `
  <li>
    <span class="ora">${i + 1}ª</span>
    <input class="materia" list="materie-orario" maxlength="60" value="${esc(materia)}" aria-label="${esc(nome)}, ${i + 1}ª ora" placeholder="Materia">
    <button type="button" class="bottone piccolo togli" aria-label="Togli questa ora">✕</button>
  </li>`;

function giornoModulo(g) {
  const nome = NOMI[g.giorno];
  const giornate = g.giornata && !GIORNATE.some(([v]) => v === g.giornata) ? [...GIORNATE, [g.giornata, g.giornata]] : GIORNATE;
  return `
    <section class="voce modulo giorno-modifica" data-giorno="${g.giorno}">
      <b>${nome}</b>
      <ol class="ore-modifica">${g.ore.map((m, i) => rigaOra(nome, m, i)).join("")}</ol>
      <p class="nota niente-scuola"${g.ore.length ? " hidden" : ""}>Se non hai scuola, lascia vuoto.</p>
      <button type="button" class="bottone piccolo aggiungi">＋ Aggiungi ora</button>
      <div class="campi-giorno"${g.ore.length ? "" : " hidden"}>
        <label>Uscita (facoltativa) <input type="time" class="uscita" value="${esc(g.uscita ? g.uscita.padStart(5, "0") : "")}"></label>
        <label>Giornata <select class="giornata">${giornate.map(([v, t]) => `<option value="${esc(v)}"${v === (g.giornata ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      </div>
    </section>`;
}

function modifica(el, dati) {
  const salvati = dati.giorni.length > 0;
  const base = salvati ? dati.giorni : dati.proposta;
  const giorni = [1, 2, 3, 4, 5, 6, ...(base.some((g) => g.giorno === 7) ? [7] : [])]
    .map((giorno) => base.find((g) => g.giorno === giorno) ?? { giorno, ore: [], uscita: null, giornata: null });
  const introduzione = salvati ? "Modifica le materie di ogni giorno, poi salva."
    : dati.proposta.length ? "Ho ricostruito l'orario dal registro. Può contenere errori: controlla ogni giorno, poi salva."
    : "Scrivi le materie di ogni giorno, in ordine, poi salva.";

  el.innerHTML = `
    <h1>${salvati ? "Modifica orario" : "Il tuo orario"}</h1>
    <p class="nota">${introduzione}</p>
    <form class="editor-orario" novalidate>
      ${giorni.map(giornoModulo).join("")}
      <fieldset class="voce modulo senza-registro">
        <legend>Quali prof non scrivono i compiti sul registro?</legend>
        <p class="nota">Il giorno prima di queste materie l'app ti ricorda di controllare se hai compiti.</p>
        <div class="scelte"></div>
      </fieldset>
      <p class="errore" role="alert"></p>
      <div class="azioni">
        <button class="bottone primario">Salva orario</button>
        ${salvati ? `<button type="button" class="bottone annulla">Annulla</button>` : ""}
      </div>
      <datalist id="materie-orario">${dati.materie.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
    </form>`;

  const form = el.querySelector("form");
  const scelte = form.querySelector(".scelte");
  const errore = form.querySelector(".errore");
  const nomiOre = () => [...form.querySelectorAll(".materia")].map((i) => i.value.trim()).filter(Boolean);
  const spuntate = () => [...scelte.querySelectorAll("input:checked")].map((i) => i.value);
  const disegnaScelte = (segnate) => {
    const nomi = [...new Set([...nomiOre(), ...segnate])].sort((a, b) => a.localeCompare(b));
    scelte.innerHTML = nomi.length
      ? nomi.map((m) => `<label class="scelta"><input type="checkbox" value="${esc(m)}"${segnate.includes(m) ? " checked" : ""}> ${esc(m)}</label>`).join("")
      : `<p class="nota">Le materie compaiono qui dopo che le hai scritte.</p>`;
  };
  const rinumera = (sezione) => {
    const righe = sezione.querySelectorAll(".ore-modifica li");
    const nome = NOMI[Number(sezione.dataset.giorno)];
    righe.forEach((li, i) => {
      li.querySelector(".ora").textContent = `${i + 1}ª`;
      li.querySelector(".materia").setAttribute("aria-label", `${nome}, ${i + 1}ª ora`);
    });
    sezione.querySelector(".niente-scuola").hidden = righe.length > 0;
    sezione.querySelector(".campi-giorno").hidden = righe.length === 0;
    sezione.querySelector(".aggiungi").disabled = righe.length >= 12;
  };

  disegnaScelte(dati.senza_registro);
  form.addEventListener("change", (e) => {
    if (e.target.classList.contains("materia")) disegnaScelte(spuntate());
  });
  form.addEventListener("click", (e) => {
    const sezione = e.target.closest(".giorno-modifica");
    if (e.target.classList.contains("aggiungi")) {
      const lista = sezione.querySelector(".ore-modifica");
      lista.insertAdjacentHTML("beforeend", rigaOra(NOMI[Number(sezione.dataset.giorno)], "", lista.children.length));
      rinumera(sezione);
      lista.lastElementChild.querySelector("input").focus();
    } else if (e.target.classList.contains("togli")) {
      e.target.closest("li").remove();
      rinumera(sezione);
      disegnaScelte(spuntate());
    } else if (e.target.classList.contains("annulla")) {
      vistaOrario(el);
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bottone = form.querySelector(".primario");
    errore.textContent = "";
    bottone.disabled = true;
    const corpo = {
      giorni: [...form.querySelectorAll(".giorno-modifica")].map((s) => ({
        giorno: Number(s.dataset.giorno),
        ore: [...s.querySelectorAll(".materia")].map((i) => i.value),
        uscita: s.querySelector(".uscita").value || null,
        giornata: s.querySelector(".giornata").value || null,
      })),
      senza_registro: spuntate(),
    };
    try {
      await api("/api/orario", { method: "PUT", body: JSON.stringify(corpo) });
      await vistaOrario(el);
    } catch (err) {
      bottone.disabled = false;
      errore.textContent = err.stato ? err.message : "Non sono riuscito a salvare. Quello che hai scritto è ancora qui: controlla la connessione e riprova.";
    }
  });
}

export async function vistaOrario(el) {
  const dati = await api("/api/orario");
  const { oggi, giorni, note } = dati;
  if (!giorni.length) {
    modifica(el, dati);
    return;
  }
  const isoOggi = new Date(`${oggi}T12:00:00Z`).getUTCDay() || 7;
  const isoDomani = (isoOggi % 7) + 1;

  el.innerHTML = `
    <div class="testa">
      <h1>Orario</h1>
      <div class="azioni"><button class="bottone" id="modifica-orario">Modifica</button></div>
    </div>
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
  el.querySelector("#modifica-orario").addEventListener("click", () => modifica(el, dati));
  document.getElementById(`giorno-${isoOggi === 7 ? 1 : isoOggi}`)?.scrollIntoView({ block: "start" });
}
