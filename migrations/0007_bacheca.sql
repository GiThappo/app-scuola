-- Circolari della bacheca di Classeviva. L'aggiornamento non tocca vista e riassunto.
-- letta = stato su Classeviva; vista = lo studente l'ha guardata nell'app (il tutor che la apre non conta).
-- riguarda, destinatari, riassunto e da_fare li carica il tutor dal PC; riguarda è 'si', 'forse' o 'no'.
CREATE TABLE bacheca (
  id INTEGER PRIMARY KEY,
  codice TEXT NOT NULL,
  titolo TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  letta INTEGER NOT NULL DEFAULT 0,
  valida INTEGER NOT NULL DEFAULT 1,
  allegati TEXT NOT NULL DEFAULT '[]',
  vista INTEGER NOT NULL DEFAULT 0,
  riguarda TEXT,
  destinatari TEXT,
  riassunto TEXT,
  da_fare TEXT,
  visto_il TEXT NOT NULL
);
