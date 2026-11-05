// Markdown delle schede di studio → HTML. Solo quello che le schede usano: titoli, paragrafi, elenchi,
// tabelle, blocchi di codice, grassetto, corsivo, `codice` e link. Tutto il testo passa da esc().

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(testo) {
  const codici = [];
  let s = esc(testo).replace(/`([^`]+)`/g, (_, c) => `\u0000${codici.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codici[i]}</code>`);
}

const celle = (riga) => riga.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const inizioTabella = (righe, i) => righe[i].trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(righe[i + 1] ?? "");
const ELENCO = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

export function markdown(testo) {
  const righe = String(testo ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  while (i < righe.length) {
    const r = righe[i];
    if (!r.trim()) { i++; continue; }

    if (r.trim().startsWith("```")) {
      const codice = [];
      for (i++; i < righe.length && !righe[i].trim().startsWith("```"); i++) codice.push(righe[i]);
      i++;
      html.push(`<pre><code>${esc(codice.join("\n"))}</code></pre>`);
      continue;
    }

    const titolo = r.match(/^(#{1,4})\s+(.*)$/);
    if (titolo) {
      const n = titolo[1].length;
      html.push(`<h${n + 1}>${inline(titolo[2])}</h${n + 1}>`);
      i++;
      continue;
    }

    if (inizioTabella(righe, i)) {
      const testa = celle(r);
      const corpo = [];
      for (i += 2; i < righe.length && righe[i].trim().startsWith("|"); i++) corpo.push(celle(righe[i]));
      html.push(`<div class="tabella"><table><thead><tr>${testa.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${corpo.map((cs) => `<tr>${cs.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const primo = r.match(ELENCO);
    if (primo) {
      const ordinato = /\d/.test(primo[2]);
      const voci = [];
      while (i < righe.length) {
        const m = righe[i].match(ELENCO);
        if (m && /\d/.test(m[2]) === ordinato && m[1].length <= primo[1].length) voci.push(m[3]);
        else if (voci.length && righe[i].trim() && /^\s+/.test(righe[i])) voci[voci.length - 1] += `\n${righe[i].trim()}`; // riga che continua la voce
        else break;
        i++;
      }
      const tag = ordinato ? "ol" : "ul";
      const inizio = ordinato && parseInt(primo[2]) !== 1 ? ` start="${parseInt(primo[2])}"` : "";
      html.push(`<${tag}${inizio}>${voci.map((v) => `<li>${v.split("\n").map(inline).join("<br>")}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (r.startsWith(">")) {
      const citazione = [];
      for (; i < righe.length && righe[i].startsWith(">"); i++) citazione.push(righe[i].replace(/^>\s?/, ""));
      html.push(`<blockquote>${inline(citazione.join(" "))}</blockquote>`);
      continue;
    }

    const paragrafo = [righe[i++].trim()]; // almeno una riga, così si va sempre avanti
    for (; i < righe.length && righe[i].trim() && !/^(#{1,4}\s|```|>)/.test(righe[i]) && !inizioTabella(righe, i) && !ELENCO.test(righe[i]); i++) paragrafo.push(righe[i].trim());
    html.push(`<p>${paragrafo.map(inline).join("<br>")}</p>`);
  }
  return html.join("\n");
}
