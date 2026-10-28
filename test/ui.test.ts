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
    "# TPSIT – Huffman", "", "Lezione: 16/10", "Seconda riga", "", "## 1. L'idea", "",
    "**In una frase:** codici *corti* e `int x;` <script>", "",
    "1. Conta", "2. Unisci", "   continua qui", "", "- a", "- b https://it.wikipedia.org/wiki/A?x=1&y=2.", "",
    "| A | B |", "|---|---|", "| `==` | **5** |", "", "```cpp", "int a = 1 < 2;", "```",
  ].join("\n");
  expect(markdown(md)).toBe([
    "<h2>TPSIT – Huffman</h2>",
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
  const testo = "REPORT DEL SABATO\n\n1. NOVITÀ <DAL> REGISTRO\n   Nessuna novità\n   Storia ............ 9            media 9.00   =\n      14:45-16:00  Italiano";
  expect(recapHtml(testo)).toBe(
    '<p class="r-titolo">REPORT DEL SABATO</p><h3>1. NOVITÀ &lt;DAL&gt; REGISTRO</h3><p class="r1">Nessuna novità</p>' +
    '<p class="r1">Storia: 9 · media 9.00 · =</p><p class="r2">14:45-16:00 · Italiano</p>');
});

test("oreLezioni", async () => {
  const { oreLezioni } = await import("../public/formato.js");
  expect(oreLezioni("13:15", 5)).toEqual(["8:15", "9:15", "10:15", "11:15", "12:15"]);
  expect(oreLezioni("14:15", 6)[0]).toBe("8:15");
  expect(oreLezioni(null, 5)).toEqual(["", "", "", "", ""]);
});

test("etichettaBlocco", async () => {
  const { etichettaBlocco } = await import("../public/formato.js");
  expect(etichettaBlocco({ tipo: "COMPITO", scadenza: "2026-10-29" }, "2026-10-28")).toEqual({ testo: "PER DOMANI", classe: "DOMANI" });
  expect(etichettaBlocco({ tipo: "COMPITO", scadenza: "2026-10-30" }, "2026-10-28")).toEqual({ testo: "COMPITO", classe: "COMPITO" });
  expect(etichettaBlocco({ tipo: "TUO", scadenza: null }, "2026-10-28")).toEqual({ testo: "TUO", classe: "TUO" });
  expect(etichettaBlocco({ tipo: "INTERROGAZIONE", scadenza: "2026-10-30" }, "2026-10-28").testo).toBe("INTERROG.");
});
