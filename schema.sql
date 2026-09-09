-- CoinCurb — Datenbank (PostgreSQL 15+)
-- Einspielen:  psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";   -- fuer E-Mail ohne Gross/klein-Unterscheidung

/* ---------- Konten ---------- */

CREATE TABLE nutzer (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              CITEXT UNIQUE NOT NULL,
  passwort_hash      TEXT,                       -- NULL bei Apple/Google-Login
  apple_sub          TEXT UNIQUE,
  google_sub         TEXT UNIQUE,
  anzeigename        TEXT NOT NULL,
  telefon            TEXT,
  email_bestaetigt   BOOLEAN NOT NULL DEFAULT FALSE,
  telefon_bestaetigt BOOLEAN NOT NULL DEFAULT FALSE,
  ausweis_geprueft   BOOLEAN NOT NULL DEFAULT FALSE,
  ausweis_hash       TEXT,                       -- Hash der Ausweisnummer, nie im Klartext
  geburtsjahr        INT,
  land               TEXT,
  sprache            TEXT DEFAULT 'de',
  gesperrt           BOOLEAN NOT NULL DEFAULT FALSE,
  sperrgrund         TEXT,
  geworben_von       UUID REFERENCES nutzer(id),
  erstellt           TIMESTAMPTZ NOT NULL DEFAULT now(),
  zuletzt_aktiv      TIMESTAMPTZ,
  geloescht_am       TIMESTAMPTZ                 -- Kontolöschung: Pflicht für den App Store
);

CREATE TABLE sitzungen (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutzer_id     UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  refresh_hash  TEXT NOT NULL,                   -- nur der Hash, nie das Token
  geraet_id     UUID,
  ip_hash       TEXT,
  laeuft_ab     TIMESTAMPTZ NOT NULL,
  widerrufen    BOOLEAN NOT NULL DEFAULT FALSE,
  erstellt      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sitzungen (nutzer_id) WHERE widerrufen = FALSE;

CREATE TABLE codes (                             -- E-Mail-Links und SMS-Codes
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nutzer_id   UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  zweck       TEXT NOT NULL,                     -- 'email' | 'telefon' | 'passwort'
  code_hash   TEXT NOT NULL,
  versuche    INT NOT NULL DEFAULT 0,
  laeuft_ab   TIMESTAMPTZ NOT NULL,
  eingeloest  TIMESTAMPTZ
);

/* ---------- Geräte (Grundlage der Betrugserkennung) ---------- */

CREATE TABLE geraete (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint   TEXT UNIQUE NOT NULL,            -- vom Client, z.B. FingerprintJS
  plattform     TEXT,
  emulator      BOOLEAN DEFAULT FALSE,
  root_jailbreak BOOLEAN DEFAULT FALSE,
  gesperrt      BOOLEAN NOT NULL DEFAULT FALSE,
  erstmals      TIMESTAMPTZ NOT NULL DEFAULT now(),
  zuletzt       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nutzer_geraet (
  nutzer_id  UUID REFERENCES nutzer(id) ON DELETE CASCADE,
  geraet_id  UUID REFERENCES geraete(id),
  ip_hash    TEXT,
  ip_typ     TEXT,                               -- 'mobil' | 'kabel' | 'vpn' | 'rechenzentrum'
  ip_land    TEXT,
  erstmals   TIMESTAMPTZ NOT NULL DEFAULT now(),
  zuletzt    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (nutzer_id, geraet_id)
);
CREATE INDEX ON nutzer_geraet (geraet_id);
CREATE INDEX ON nutzer_geraet (ip_hash);

/* ---------- Geld ---------- */

-- Jede Bewegung ist eine Zeile. Nichts wird überschrieben, nur ergänzt.
CREATE TABLE buchungen (
  id             BIGSERIAL PRIMARY KEY,
  nutzer_id      UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  art            TEXT NOT NULL,                  -- 'aufgabe'|'bonus'|'werbung'|'auszahlung'|'storno'|'korrektur'
  coins          BIGINT NOT NULL,                -- negativ bei Abgang
  titel          TEXT,
  partner        TEXT,
  partner_tx     TEXT,                           -- Transaktions-ID des Anbieters
  status         TEXT NOT NULL DEFAULT 'haltefrist', -- 'haltefrist'|'frei'|'zurueckgehalten'|'storniert'
  frei_ab        TIMESTAMPTZ,
  risiko_punkte  INT,
  erstellt       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Verhindert, dass ein Anbieter dieselbe Gutschrift zweimal auslöst:
CREATE UNIQUE INDEX buchungen_partner_tx ON buchungen (partner, partner_tx)
  WHERE partner_tx IS NOT NULL;
CREATE INDEX ON buchungen (nutzer_id, status);

CREATE TABLE auszahlungen (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beleg_nr      TEXT UNIQUE NOT NULL,
  nutzer_id     UUID NOT NULL REFERENCES nutzer(id),
  methode       TEXT NOT NULL,
  ziel          TEXT NOT NULL,                   -- E-Mail, IBAN, Wallet
  ziel_hash     TEXT NOT NULL,                   -- für die Mehrfachkonto-Prüfung
  betrag_eur    NUMERIC(10,2) NOT NULL,
  gebuehr_eur   NUMERIC(10,2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pruefung',-- 'pruefung'|'laeuft'|'ausgezahlt'|'abgelehnt'
  anbieter_ref  TEXT,
  risiko_punkte INT,
  bearbeiter    TEXT,
  erstellt      TIMESTAMPTZ NOT NULL DEFAULT now(),
  erledigt      TIMESTAMPTZ
);
CREATE INDEX ON auszahlungen (ziel_hash);
CREATE INDEX ON auszahlungen (status);

/* ---------- Verhalten (Aufgabenstarts, gemeldet vom Client) ---------- */

CREATE TABLE aufgaben_starts (
  id                   BIGSERIAL PRIMARY KEY,
  nutzer_id            UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  partner              TEXT NOT NULL,
  angebot              TEXT,                         -- Angebots-ID oder -Name des Partners
  erwartete_dauer_sek  INT,                          -- was der Partner/Client als Dauer angibt
  gestartet            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON aufgaben_starts (nutzer_id, gestartet DESC);
CREATE INDEX ON aufgaben_starts (partner, angebot, gestartet DESC);

/* ---------- Betrug ---------- */

CREATE TABLE risiko_verlauf (
  id         BIGSERIAL PRIMARY KEY,
  nutzer_id  UUID NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
  punkte     INT NOT NULL,
  stufe      TEXT NOT NULL,
  treffer    TEXT[],
  anlass     TEXT,                               -- 'postback'|'auszahlung'|'login'
  erstellt   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sperrliste (
  id       BIGSERIAL PRIMARY KEY,
  typ      TEXT NOT NULL,                        -- 'geraet'|'ip'|'auszahlziel'|'email'|'ausweis'
  wert     TEXT NOT NULL,
  grund    TEXT,
  gesetzt  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (typ, wert)
);

CREATE TABLE protokoll (                          -- jede Sperre und Freigabe nachvollziehbar
  id         BIGSERIAL PRIMARY KEY,
  nutzer_id  UUID,
  aktion     TEXT NOT NULL,
  details    JSONB,
  wer        TEXT,
  erstellt   TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------- Abfragen, die die App braucht ---------- */

CREATE VIEW guthaben AS
SELECT nutzer_id,
       SUM(coins)                                          AS coins_gesamt,
       SUM(coins) FILTER (WHERE status = 'frei'
            OR (status = 'haltefrist' AND frei_ab < now())) AS coins_frei
FROM buchungen
WHERE status <> 'storniert'
GROUP BY nutzer_id;
-- Wichtig: 'zurueckgehalten' (Schattensperre) zaehlt NIE als frei,
-- auch wenn die Frist abgelaufen ist. Freigabe nur von Hand.

-- Haltefrist regelmäßig auflösen (per Cron, z.B. jede Minute):
-- UPDATE buchungen SET status='frei' WHERE status='haltefrist' AND frei_ab < now();
