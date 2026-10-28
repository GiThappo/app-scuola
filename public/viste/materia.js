import { api, esc } from "../app.js";
import { classeMedia, etichettaGiorno } from "../formato.js";
import { dentroApp, titoloFile, urlFile } from "./file.js";

const data = (d) => d.split("-").reverse().slice(0, 2).join("/");
const peso = (n) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(1).replace(".", ",")} MB`);

function voceFile(f) {
  const est = f.nome.split(".").pop().toUpperCase();
  return dentroApp(f)
    ? `<a class="voce" href="#/file/${encodeURIComponent(f.percorso)}"><span class="tipo-file">${f.nome.endsWith(".md") ? "MD" : "TXT"}</span><div class="corpo">${esc(titoloFile(f.nome))}</div></a>`
    : `<a class="voce" href="${urlFile(f.percorso)}" target="_blank" rel="noopener">
        <span class="tipo-file ${esc(est)}">${esc(est)}</span><div class="corpo">${esc(f.nome.replace(/\.[^.]+$/, ""))}<div class="nota">${esc(est)} · ${peso(f.dimensione)}</div></div></a>`;
}

const SEZIONI = [["schede", "Schede"], ["fonti", "PDF e fonti"], ["appunti", "Appunti"]];

export async function vistaMateria(el, nome) {
  const m = await api(`/api/materie/${encodeURIComponent(nome)}`);
  const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const voti = m.voti.length
    ? m.voti.map((v) => `
        <div class="voce ${v.blu ? "voto-blu" : ""}">
          <span class="voto ${v.blu ? "blu" : classeMedia(v.valore)}">${esc(v.voto)}</span>
          <div class="corpo">
            <span class="${v.nuovo ? "nuovo" : ""}">${esc(v.tipo || "Voto")} · ${esc(data(v.data))}</span>
            ${v.blu ? `<div class="nota">non fa media</div>` : ""}
            ${v.nota ? `<div class="nota">${esc(v.nota)}</div>` : ""}
          </div>
        </div>`).join("")
    : `<p class="vuoto">Nessun voto.</p>`;
  const inArrivo = m.in_arrivo.length
    ? `<h2>In arrivo</h2>${m.in_arrivo.map((v) => `
        <div class="voce"><span class="tag ${esc(v.tipo)}">${esc(v.tipo)}</span>
          <div class="corpo">${esc(etichettaGiorno(v.scadenza, oggi))}<div>${esc(v.testo)}</div></div></div>`).join("")}`
    : "";
  const lezioni = m.lezioni.length
    ? m.lezioni.map((l) => `
        <div class="voce"><div class="corpo">${esc(data(l.data))} · ${l.ore.length === 1 ? "1 ora" : `${l.ore.length} ore`}
          <div class="${l.argomento ? "" : "nota"}">${esc(l.argomento || "argomento non scritto")}</div></div></div>`).join("")
    : `<p class="vuoto">Nessuna lezione nelle ultime settimane.</p>`;

  const materiale = SEZIONI.filter(([k]) => m.materiale[k].length)
    .map(([k, titolo]) => `<h2>${titolo}</h2><div class="lista">${m.materiale[k].map(voceFile).join("")}</div>`).join("");

  el.innerHTML = `
    <div class="testa">
      <h1><a href="#/materie" aria-label="Indietro">‹</a> ${esc(m.nome)}</h1>
      <span class="media ${classeMedia(m.media)}">media ${m.media == null ? "—" : m.media.toFixed(2).replace(".", ",")}</span>
    </div>
    <div class="sotto">${m.media_classeviva ? "Media di Classeviva" : "Media calcolata dall'app"}${m.voti.some((v) => v.blu) ? " · i voti blu non fanno media" : ""}</div>
    <h2>Voti</h2>${voti}${inArrivo}${materiale}<h2>Diario lezioni</h2>${lezioni}`;
}
