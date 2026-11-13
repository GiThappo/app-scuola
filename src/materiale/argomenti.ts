// Un argomento sul PC sono due file con lo stesso nome in <Materia>/argomenti/:
// "N. Titolo.pdf" (il PDF di studio) e "N. Titolo.md" (il super riassunto).

export type Argomento = { numero: number | null; titolo: string; pdf: string | null; riassunto: string | null };

const NUMERO = /^(\d+)\.\s*/;

/** Accoppia PDF e riassunti per nome; dal numero più alto (il più recente), quelli senza numero in fondo. */
export function raggruppaArgomenti(file: { percorso: string; nome: string }[]): Argomento[] {
  const perNome = new Map<string, Argomento>();
  for (const f of file) {
    const est = f.nome.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    if (est !== "pdf" && est !== "md") continue;
    const chiave = f.nome.slice(0, -(est.length + 1));
    const numero = chiave.match(NUMERO)?.[1];
    const a = perNome.get(chiave) ?? { numero: numero ? Number(numero) : null, titolo: chiave.replace(NUMERO, ""), pdf: null, riassunto: null };
    if (est === "pdf") a.pdf = f.percorso;
    else a.riassunto = f.percorso;
    perNome.set(chiave, a);
  }
  return [...perNome.values()].sort((a, b) =>
    a.numero == null || b.numero == null
      ? (a.numero == null ? 1 : 0) - (b.numero == null ? 1 : 0) || a.titolo.localeCompare(b.titolo, "it")
      : b.numero - a.numero);
}
