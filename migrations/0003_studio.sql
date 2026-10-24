-- Blocchi di studio. chiave = sessione del piano automatico (NULL per quelli aggiunti a mano).
-- manuale = spostato o aggiunto dallo studente: il piano automatico non lo tocca.
CREATE TABLE blocchi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chiave TEXT UNIQUE,
  materia TEXT NOT NULL,
  cosa TEXT NOT NULL,
  dettagli TEXT NOT NULL DEFAULT '',
  voce_id INTEGER,
  inizio TEXT NOT NULL, -- ora di Roma, YYYY-MM-DDTHH:MM
  durata INTEGER NOT NULL, -- minuti
  manuale INTEGER NOT NULL DEFAULT 0,
  fatto INTEGER NOT NULL DEFAULT 0,
  eliminato INTEGER NOT NULL DEFAULT 0,
  versione INTEGER NOT NULL DEFAULT 1
);

-- Impegni letti da Google Calendar (prossimi 14 giorni), ora di Roma
CREATE TABLE impegni (id TEXT PRIMARY KEY, titolo TEXT, inizio TEXT NOT NULL, fine TEXT NOT NULL);
