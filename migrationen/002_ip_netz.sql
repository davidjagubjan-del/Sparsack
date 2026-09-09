-- Aufgabe 7: Cache fuer die Proxy-/VPN-Pruefung (IPQualityScore).
-- Fuer bestehende Datenbanken: psql "$DATABASE_URL" -f migrationen/002_ip_netz.sql

CREATE TABLE IF NOT EXISTS ip_netz (
  ip_hash   TEXT PRIMARY KEY,
  typ       TEXT NOT NULL,
  land      TEXT,
  geprueft  TIMESTAMPTZ NOT NULL DEFAULT now()
);
