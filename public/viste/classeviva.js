import { api, esc } from "../app.js";

export async function vistaClasseviva(el) {
  const stato = await api("/api/stato");
  const titolo = stato.classeviva === "mancante" ? "Collega Classeviva" : "Dati di Classeviva";
  const spiegazione = stato.classeviva === "rifiutata"
    ? `Classeviva non ha accettato i dati salvati. Se hai cambiato password, scrivi qui quella nuova.`
    : "Usa gli stessi dati con cui entri sul sito o nell'app di Classeviva.";
  el.innerHTML = `
    <h1>${titolo}</h1>
    <p class="nota">${esc(spiegazione)}</p>
    <form class="voce modulo" autocomplete="off">
      <label>Nome utente <input name="utente" required maxlength="100" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"></label>
      <label>Password <input name="password" type="password" required maxlength="200" autocomplete="current-password"></label>
      <p class="errore" role="alert"></p>
      <div class="azioni"><button class="bottone primario">Collega</button><a class="bottone" href="#/agenda">Annulla</a></div>
    </form>
    <p class="nota">L'app controlla i dati con Classeviva e li salva cifrati nel tuo account. Li usa solo per scaricare il registro.</p>`;
  const form = el.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bottone = form.querySelector("button");
    const errore = form.querySelector(".errore");
    errore.textContent = "";
    bottone.disabled = true;
    bottone.textContent = "Controllo…";
    try {
      await api("/api/classeviva", { method: "POST", body: JSON.stringify({ utente: form.utente.value, password: form.password.value }) });
      form.password.value = "";
      location.hash = "#/agenda";
    } catch (err) {
      errore.textContent = err.message;
      bottone.disabled = false;
      bottone.textContent = "Collega";
    }
  });
}
