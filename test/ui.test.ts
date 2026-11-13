import { expect, test } from "vitest";
import { etichettaGiorno, daQuanto } from "../public/formato.js";

test("etichettaGiorno", () => {
  expect(etichettaGiorno("2026-10-24", "2026-10-23")).toBe("Domani · sab 24");
  expect(etichettaGiorno("2026-10-23", "2026-10-23")).toBe("Oggi · ven 23");
  expect(etichettaGiorno("2026-10-26", "2026-10-23")).toBe("Lun 26");
  expect(etichettaGiorno("2026-11-02", "2026-10-23")).toBe("Lun 2 nov");
});

test("daQuanto", () => {
  const now = new Date("2026-10-23T14:00:00Z"); // 16:00 a Roma
  expect(daQuanto("2026-10-23T13:59:30Z", now)).toBe("adesso");
  expect(daQuanto("2026-10-23T13:55:00Z", now)).toBe("5 min fa");
  expect(daQuanto("2026-10-23T13:00:00Z", now)).toBe("1 ora fa");
  expect(daQuanto("2026-10-23T12:00:00Z", now)).toBe("2 ore fa");
  expect(daQuanto("2026-10-22T16:00:00Z", now)).toBe("ieri alle 18:00");
  expect(daQuanto("2026-10-20T07:30:00Z", now)).toBe("il 20/10 alle 09:30");
});

test("markdown delle schede", async () => {
  const { markdown } = await import("../public/markdown.js");
  const md = [
    "# Fisica – Moto", "", "Lezione: 16/10", "Seconda riga", "", "## 1. L'idea", "",
    "**In una frase:** codici *corti* e `int x;` <script>", "",
    "1. Conta", "2. Unisci", "   continua qui", "", "- a", "- b https://it.wikipedia.org/wiki/A?x=1&y=2.", "",
    "| A | B |", "|---|---|", "| `==` | **5** |", "", "```cpp", "int a = 1 < 2;", "```",
  ].join("\n");
  expect(markdown(md)).toBe([
    "<h2>Fisica – Moto</h2>",
    "<p>Lezione: 16/10<br>Seconda riga</p>",
    "<h3>1. L&#39;idea</h3>",
    "<p><strong>In una frase:</strong> codici <em>corti</em> e <code>int x;</code> &lt;script&gt;</p>",
    "<ol><li>Conta</li><li>Unisci<br>continua qui</li></ol>",
    `<ul><li>a</li><li>b <a href="https://it.wikipedia.org/wiki/A?x=1&amp;y=2" target="_blank" rel="noopener">https://it.wikipedia.org/wiki/A?x=1&amp;y=2</a>.</li></ul>`,
    `<div class="tabella"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><code>==</code></td><td><strong>5</strong></td></tr></tbody></table></div>`,
    "<pre><code>int a = 1 &lt; 2;</code></pre>",
  ].join("\n"));
  expect(markdown("[x](javascript:alert(1))")).not.toContain("href");
});

test("markdown: una riga che sembra una tabella ma non lo è non blocca tutto", async () => {
  const { markdown } = await import("../public/markdown.js");
  expect(markdown("| solo una riga |\nsegue")).toBe("<p>| solo una riga |<br>segue</p>");
});

test("markdown: il valore assoluto |x| resta nel paragrafo", async () => {
  const { markdown } = await import("../public/markdown.js");
  expect(markdown("In generale:\n|5| = 5\n|−5| = 5")).toBe("<p>In generale:<br>|5| = 5<br>|−5| = 5</p>");
});

test("recapHtml", async () => {
  const { recapHtml } = await import("../public/formato.js");
  const testo = "REPORT DEL SABATO\n\n1. NOVITÀ <DAL> REGISTRO\n   Nessuna novità\n   Storia ............ 7            media 7.00   =\n      14:45-16:00  Italiano";
  expect(recapHtml(testo)).toBe(
    '<p class="r-titolo">REPORT DEL SABATO</p><h3>1. NOVITÀ &lt;DAL&gt; REGISTRO</h3><p class="r1">Nessuna novità</p>' +
    '<p class="r1">Storia: 7 · media 7.00 · =</p><p class="r2">14:45-16:00 · Italiano</p>');
});

test("oreLezioni", async () => {
  const { oreLezioni } = await import("../public/formato.js");
  expect(oreLezioni("13:00", 5)).toEqual(["8:00", "9:00", "10:00", "11:00", "12:00"]);
  expect(oreLezioni("14:00", 6)[0]).toBe("8:00");
  expect(oreLezioni(null, 5)).toEqual(["", "", "", "", ""]);
});

test("messaggiVuoto: dice \"niente\" solo se il registro è stato controllato", async () => {
  const { messaggiVuoto } = await import("../public/formato.js");
  const adesso = new Date("2026-11-06T12:00:00Z");

  const mai = messaggiVuoto({ ultimo_ok: null, ultimo_errore: "Identificativo o password errati" }, adesso);
  for (const testo of [mai.domani, mai.avanti, mai.studio]) {
    expect(testo).toContain("Non so ancora");
    expect(testo).not.toContain("Niente");
  }

  const fallito = messaggiVuoto({ ultimo_ok: "2026-11-06T10:00:00Z", ultimo_errore: "Classeviva non risponde" }, adesso);
  for (const testo of [fallito.domani, fallito.avanti, fallito.studio]) {
    expect(testo).toContain("all'ultimo controllo riuscito (2 ore fa)");
    expect(testo).toContain("potrebbe essere cambiato qualcosa");
  }

  expect(messaggiVuoto({ ultimo_ok: "2026-11-06T11:59:30Z", ultimo_errore: null }, adesso)).toEqual({
    domani: "Niente sul registro per domani.",
    avanti: "Niente più avanti nei prossimi 30 giorni.",
    studio: "Niente da studiare nei prossimi 14 giorni. Le verifiche e i compiti del registro compaiono qui da soli.",
  });
});

test("percorsoCaricamento: nomi diversi anche con foto chiamate uguali, e percorso accettato dal server", async () => {
  const { percorsoCaricamento } = await import("../public/formato.js");
  const { leggiPercorso } = await import("../src/materiale/api");
  const adesso = new Date("2026-11-06T13:30:05Z");
  const p = percorsoCaricamento("Sistemi e reti", "image.jpg", adesso);
  expect(p).toBe("Sistemi e reti/appunti/dal telefono 2026-11-06 14.30.05 image.jpg");
  expect(percorsoCaricamento("Sistemi e reti", "image.jpg", new Date("2026-11-06T13:30:06Z"))).not.toBe(p);
  expect(leggiPercorso(p)).toMatchObject({ materia: "Sistemi e reti", tipo: "appunti", mime: "image/jpeg" });
  expect(leggiPercorso(percorsoCaricamento("A/B", "c/d.pdf", adesso))).toMatchObject({ materia: "A B", tipo: "appunti" });
  expect(leggiPercorso(percorsoCaricamento("Storia", "foto.heic", adesso))).toBeNull();
});

test("avvisoAggiornamento: niente allarmi se i dati sono recenti, a meno che l'errore serva", async () => {
  const { avvisoAggiornamento } = await import("../public/formato.js");
  const adesso = new Date("2026-11-06T12:00:00Z");
  const fa = (ore: number) => new Date(adesso.getTime() - ore * 3600_000).toISOString();
  const giu = { ultimo_errore: "Classeviva non risponde", classeviva: "ok" };
  expect(avvisoAggiornamento({ ...giu, ultimo_ok: fa(1) }, adesso)).toBe(false);
  expect(avvisoAggiornamento({ ...giu, ultimo_ok: fa(7) }, adesso)).toBe(true);
  expect(avvisoAggiornamento({ ...giu, ultimo_ok: null }, adesso)).toBe(true);
  expect(avvisoAggiornamento({ ...giu, ultimo_ok: fa(1) }, adesso, { appenaProvato: true })).toBe(true);
  expect(avvisoAggiornamento({ ...giu, classeviva: "rifiutata", ultimo_ok: fa(1) }, adesso)).toBe(true);
  expect(avvisoAggiornamento({ ultimo_errore: null, classeviva: "ok", ultimo_ok: fa(30) }, adesso)).toBe(false);
});

test("messaggiVuoto: con dati recenti un errore passeggero non cambia il testo", async () => {
  const { messaggiVuoto } = await import("../public/formato.js");
  const adesso = new Date("2026-11-06T12:00:00Z");
  const recente = messaggiVuoto({ ultimo_ok: "2026-11-06T11:00:00Z", ultimo_errore: "giù" }, adesso, { avviso: false });
  expect(recente.domani).toBe("Niente sul registro per domani.");
});

test("etichettaBlocco", async () => {
  const { etichettaBlocco } = await import("../public/formato.js");
  expect(etichettaBlocco({ tipo: "COMPITO", scadenza: "2026-10-29" }, "2026-10-28")).toEqual({ testo: "PER DOMANI", classe: "DOMANI" });
  expect(etichettaBlocco({ tipo: "COMPITO", scadenza: "2026-10-30" }, "2026-10-28")).toEqual({ testo: "COMPITO", classe: "COMPITO" });
  expect(etichettaBlocco({ tipo: "TUO", scadenza: null }, "2026-10-28")).toEqual({ testo: "TUO", classe: "TUO" });
  expect(etichettaBlocco({ tipo: "INTERROGAZIONE", scadenza: "2026-10-30" }, "2026-10-28").testo).toBe("INTERROG.");
});

test("argomenti", async () => {
  const { rigaArgomento, corpoArgomento } = await import("../public/argomenti.js");
  const a = { numero: 3, titolo: "Dante <vita>", pdf: "Italiano/argomenti/3. Dante.pdf", riassunto: "Italiano/argomenti/3. Dante.md" };
  expect(rigaArgomento(a, 0, false)).toContain("Dante &lt;vita&gt;");
  expect(rigaArgomento(a, 0, false)).toContain('aria-expanded="false"');
  expect(rigaArgomento(a, 0, true)).toContain('aria-expanded="true"');
  const c = corpoArgomento(a, "**Dante nasce a Firenze**<script>");
  expect(c).toContain("<strong>Dante nasce a Firenze</strong>&lt;script&gt;");
  expect(c).toContain('href="/api/file/Italiano/argomenti/3.%20Dante.pdf"');
  expect(corpoArgomento({ ...a, pdf: null }, "x")).not.toContain("Apri il PDF");
  expect(corpoArgomento({ ...a, riassunto: null }, null)).toContain("Apri il PDF");
});

test("argomenti: riassunto che non si scarica", async () => {
  const { corpoArgomento } = await import("../public/argomenti.js");
  const a = { numero: 1, titolo: "X", pdf: "M/argomenti/1. X.pdf", riassunto: "M/argomenti/1. X.md" };
  const c = corpoArgomento(a, null, { errore: true });
  expect(c).toContain("Il riassunto non si è caricato");
  expect(c).toContain("Apri il PDF");
  expect(corpoArgomento(a, "ok")).not.toContain("non si è caricato");
});
