import { api } from "../app.js";

export function vistaLogin(el, dopo) {
  el.innerHTML = `
    <form class="login">
      <h1>Scuola</h1>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus>
      <button class="bottone primario">Entra</button>
      <p class="errore" role="alert"></p>
    </form>`;
  const form = el.querySelector("form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const bottone = form.querySelector("button");
    bottone.disabled = true;
    try {
      await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.password.value }),
      });
      dopo();
    } catch (e) {
      form.querySelector(".errore").textContent = e.message;
      bottone.disabled = false;
    }
  });
}
