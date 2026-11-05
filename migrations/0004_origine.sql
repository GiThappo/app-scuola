-- Evento di Google Calendar adottato dall'app (piano fatto prima dal tutor): una volta sola
ALTER TABLE blocchi ADD COLUMN origine TEXT;
CREATE UNIQUE INDEX blocchi_origine ON blocchi (origine);
