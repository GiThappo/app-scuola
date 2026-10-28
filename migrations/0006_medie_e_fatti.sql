-- Voti blu di Classeviva: si vedono ma non fanno media
ALTER TABLE voti ADD COLUMN blu INTEGER NOT NULL DEFAULT 0;

-- Medie per materia calcolate da Classeviva (students/{id}/avg)
CREATE TABLE medie (materia TEXT PRIMARY KEY, media REAL, n_voti INTEGER NOT NULL DEFAULT 0);

-- Compito segnato fatto dallo studente (l'aggiornamento da Classeviva non lo tocca)
ALTER TABLE agenda ADD COLUMN fatto INTEGER NOT NULL DEFAULT 0;
