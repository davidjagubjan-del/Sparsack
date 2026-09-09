-- Aufgabe 6: Aufgabenstarts fuer die Verhaltens-Kennzahlen.
-- Fuer bestehende Datenbanken: psql "$DATABASE_URL" -f migrationen/001_aufgaben_starts.sql
-- (Neue Datenbanken bekommen die Tabelle direkt ueber schema.sql.)

CREATE TABLE IF NOT EXISTS aufgaben_starts (
  id                   BIGSERIAL PRIMARY KEY,
  nutzer_id            UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  partner              TEXT NOT NULL,
  angebot              TEXT,
  erwartete_dauer_sek  INT,
  gestartet            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aufgaben_starts_nutzer_idx ON aufgaben_starts (nutzer_id, gestartet DESC);
CREATE INDEX IF NOT EXISTS aufgaben_starts_angebot_idx ON aufgaben_starts (partner, angebot, gestartet DESC);
