# CLAUDE.md — CoinCurb

Rewards-App („Geld verdienen mit Aufgaben") nach dem Vorbild Freecash, eigenes Design.
Nutzer erledigen Angebote von Offerwall-Partnern, bekommen Coins, zahlen sie aus.
Alle Aufgaben stehen priorisiert in `AUFGABEN.md` — dort von oben nach unten arbeiten.

## Stack & Dateien

- Node 18+, ESM (`"type": "module"`), Express, PostgreSQL 15+ — kein TypeScript, kein ORM
- `server.js` — Partner-Postbacks (`PARTNER`: je Anbieter Signaturpruefung, Parameter-Mapping, Antwort; reine Formeln in `signaturen`), Auszahlungen, Betrugserkennung (16 Regeln + harte Sperren)
- `auth.js` — Registrierung, Login, Apple-Login, E-Mail/SMS-Codes, Token-Rotation, Kontolöschung, `netzTyp()` (IPQualityScore, Cache in `ip_netz`)
- `auszahlung.js` — Zahlungsdienste: PayPal Payouts (`paypal`), Tango Card RaaS (`tango`); bekommen Auftrag + entschlüsseltes Ziel, liefern `{ status, ref, grund }`, werfen bei Dienstfehlern
- `versand.js` — Mail über Resend (`mail.senden`), SMS-Codes über Twilio Verify (`sms.codeSenden` / `sms.codePruefen`; Twilio erzeugt und prüft den Code, bei uns liegt nur der Hash der bestätigten Nummer)
- `admin.js` — Admin-Router unter `/admin` (HTTP Basic mit `ADMIN_PASSWORT`, Nutzer „admin“; HTML-Formulare und JSON); Auszahlungen in Prüfung freigeben/ablehnen, Konten sperren/entsperren, Sperrliste; jede Aktion im `protokoll` mit `wer = "admin"`; POSTs nur von der eigenen Origin
- `db.js` — einzige Stelle mit SQL; exportiert `db` und `hash()`; `auszahlungZiel()` ist die einzige Stelle, die ein Auszahlungsziel entschlüsselt
- `schema.sql` — Tabellen; einspielen mit `psql "$DATABASE_URL" -f schema.sql`
- `migrationen/` — Nachträge für bestehende Datenbanken (nummeriert, idempotent); jede Schemaänderung landet in beiden Dateien
- `CoinCurb.jsx` — React-Frontend (eine Datei, eigenes CSS, kein Tailwind); `API_BASE` aus `VITE_API_BASE` oder `window.COINCURB_API_BASE`, leer = Demo-Daten. Fetch-Layer `api()` mit Token-Refresh, Login-Screen, Screens auf `/api/ich`, `/api/walls`, `/api/auszahlung`, `/api/auszahlung/wege`, `/api/verlauf`, `/api/security`; Kontolöschung sichtbar im Tab „Konto“
- `app/` — Vite + Capacitor um `CoinCurb.jsx` (importiert die Datei aus dem Wurzelverzeichnis, keine Kopie); `app/src/main.jsx` setzt `window.COINCURB_API_BASE`, `COINCURB_PLATTFORM`, `COINCURB_GERAET_ID`, `COINCURB_EMULATOR` aus dem nativen Kontext (`@capacitor/device`); `android/` und `ios/` werden mit `npx cap add` erzeugt und nicht eingecheckt
- Start: `npm install && npm start` — bricht ohne gültige `.env` bewusst ab (siehe `.env.example`)
- `server.js` exportiert die App (`export default app`) und lauscht nur beim direkten Start; Tests importieren sie
- Auszahlungswege werden über `AUSZAHLUNG_AKTIV`, Partner-IP-Listen über `<PARTNER>_IPS` in der `.env` geschaltet
- helmet läuft mit `Referrer-Policy: same-origin` (bei `no-referrer` schicken Browser `Origin: null` und same-origin-Formulare scheitern an CORS); CORS erlaubt `APP_URL`, `CORS_ORIGINS` und die eigene Origin des Servers

## Unumstößliche Regeln

1. **1.000 Coins = 1,00 €.** Nirgends anders umrechnen.
2. **Jede Geldbewegung ist eine neue Zeile in `buchungen`.** Niemals Beträge per UPDATE ändern. Guthaben ist immer die Summe, gelesen über die View `guthaben`.
3. Buchungs-Status nur: `haltefrist | frei | zurueckgehalten | storniert`. `zurueckgehalten` (Schattensperre) wird NIE automatisch frei — nur von Hand.
4. **Nutzer-ID nie aus Body/Query nehmen**, immer aus `req.nutzer.id` (Middleware `angemeldet`). Die Auszahlungsroute war genau deshalb schon einmal kritisch verwundbar.
5. Telefonnummern, Auszahlungsziele, IPs: nur als `hash()` speichern bzw. verschlüsselt, nie loggen. Secrets nur in `.env`, nie in Code, Logs oder Fehlermeldungen.
6. Postbacks: Signatur zuerst prüfen, `(partner, partner_tx)` ist unique (Replay-Schutz), Antwort an Partner immer `200 "ok"` — auch bei Duplikaten und unbekannter Nutzer-ID.
7. Auszahlung: erst Minus-Buchung, dann Endstand prüfen, bei < 0 zurückdrehen (Schutz vor Doppelanfragen). Diese Reihenfolge nicht „optimieren". Wird ein Auftrag abgelehnt (Dienstfehler, PayPal DENIED), kommt das Geld als `korrektur`-Buchung zurück; `db.auszahlungAbschliessen` setzt den Status nur aus `laeuft`/`pruefung` heraus, damit nie doppelt zurückgebucht wird.
8. Fehlermeldungen an Nutzer auf Deutsch, per Du, ohne Technik-Details. Interne Kommentare bleiben im Stil der bestehenden Dateien (Deutsch).
9. Betrugsregeln (`REGELN` in server.js): Gewichte nur ändern, wenn die Aufgabe es verlangt. Neue Kennzahlen in `db.kennzahlenFuer` ergänzen, Standardwert immer „unauffällig".
10. Nichts von Apple/Google-Richtlinien Relevantes entfernen: Kontolöschung, Altersgrenze 16+, iOS-Build ohne belohnte App-Installationen (nur Umfragen/Web-Angebote). Umgesetzt serverseitig in `/api/walls`: bei `X-Platform: ios` nur Partner mit `appInstalls: false`; neue Partner brauchen dieses Feld in `PARTNER`.

## Prüfen nach jeder Änderung

```
node --check server.js auth.js db.js
npm test        # vitest + supertest gegen TEST_DATABASE_URL (Name muss auf _test enden, wird jedes Mal neu aufgebaut)
```

Tests liegen in `test/`; Hilfen zum Anlegen von Nutzern, Guthaben und signierten Postbacks in `test/hilfen.js`.
Neue Routen und Regeln bekommen dort einen Test, bevor die Aufgabe abgehakt wird.
