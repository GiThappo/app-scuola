-- Materiale di studio caricato dal PC (scripts/carica-materiale.mjs). percorso = "<Materia>/<fonti|schede|appunti>/<nome>"
CREATE TABLE file (
  percorso TEXT PRIMARY KEY,
  materia TEXT NOT NULL,
  tipo TEXT NOT NULL, -- fonti, schede, appunti
  nome TEXT NOT NULL,
  mime TEXT NOT NULL,
  dimensione INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caricato_il TEXT NOT NULL
);
-- Il contenuto a pezzi da 1 MB: in D1 una riga non può superare 2 MB
CREATE TABLE file_pezzi (percorso TEXT NOT NULL, n INTEGER NOT NULL, dati BLOB NOT NULL, PRIMARY KEY (percorso, n));

-- Recap del giorno scritto dal tutor (~/Scuola/report/AAAA-MM-GG.txt)
CREATE TABLE recap (data TEXT PRIMARY KEY, testo TEXT NOT NULL, caricato_il TEXT NOT NULL);
