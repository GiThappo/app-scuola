import { api, esc } from "../app.js";
import { etichettaGiorno } from "../formato.js";

const data = (d) => d.split("-").reverse().slice(0, 2).join("/");

export async function vistaMateria(el, nome) {
  const m = await api(`/api/materie/${encodeURIComponent(nome)}`);
  const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const voti = m.voti.length
    ? m.voti.map((v) => `
        <div class="voce"><div class="corpo">
          <b class="${v.nuovo ? "nuovo" : ""}">${esc(v.voto)}</b> · ${esc(v.tipo)} · ${esc(data(v.data))}
          ${v.nota ? `<div class="nota">${esc(v.nota)}</div>` : ""}
        </div></div>`).join("")
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

  el.innerHTML = `
    <div class="testa">
      <h1><a href="#/materie" aria-label="Indietro">‹</a> ${esc(m.nome)}</h1>
      <span class="media ${m.media != null && m.media < 6 ? "basso" : ""}">media ${m.media == null ? "—" : m.media.toFixed(2).replace(".", ",")}</span>
    </div>
    <h2>Voti</h2>${voti}${inArrivo}<h2>Diario lezioni</h2>${lezioni}`;
}
