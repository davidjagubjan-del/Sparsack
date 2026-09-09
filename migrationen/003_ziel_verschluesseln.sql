-- Aufgabe 10: Auszahlungsziele verschluesselt ablegen (pgcrypto, Schluessel aus der .env).
-- Einspielen MIT Schluessel als psql-Variable:
--   psql "$DATABASE_URL" -v ziel_schluessel="$ZIEL_SCHLUESSEL" -f migrationen/003_ziel_verschluesseln.sql
-- Laeuft nur einmal: ist die Spalte schon BYTEA, wird nichts veraendert.

SELECT set_config('coincurb.ziel_schluessel', :'ziel_schluessel', false);

DO $$
BEGIN
  IF length(current_setting('coincurb.ziel_schluessel')) < 32 THEN
    RAISE EXCEPTION 'ziel_schluessel fehlt oder ist zu kurz (psql -v ziel_schluessel=...)';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name = 'auszahlungen' AND column_name = 'ziel') = 'text' THEN
    EXECUTE format('ALTER TABLE auszahlungen ALTER COLUMN ziel TYPE BYTEA USING pgp_sym_encrypt(ziel, %L)',
                   current_setting('coincurb.ziel_schluessel'));
  END IF;
END $$;
