CREATE TABLE voti (
  id INTEGER PRIMARY KEY,
  materia TEXT NOT NULL,
  data TEXT NOT NULL,
  voto TEXT,
  valore REAL,
  peso REAL,
  tipo TEXT,
  periodo INTEGER,
  nota TEXT,
  visto_il TEXT NOT NULL
);

CREATE TABLE agenda (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  materie TEXT NOT NULL, -- JSON
  testo TEXT,
  docente TEXT,
  tipo TEXT NOT NULL,
  scadenza TEXT,
  dedotta INTEGER NOT NULL DEFAULT 0,
  visto_il TEXT NOT NULL
);

CREATE TABLE lezioni (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  ora INTEGER,
  materia TEXT NOT NULL,
  argomento TEXT,
  tipo TEXT
);

CREATE TABLE giorni (data TEXT PRIMARY KEY, scuola INTEGER NOT NULL);

CREATE TABLE periodi (pos INTEGER PRIMARY KEY, nome TEXT, inizio TEXT, fine TEXT);

CREATE TABLE impostazioni (chiave TEXT PRIMARY KEY, valore TEXT);
