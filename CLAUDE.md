# CLAUDE.md — CoinCurb

Rewards-App („Geld verdienen mit Aufgaben") nach dem Vorbild Freecash, eigenes Design.
Nutzer erledigen Angebote von Offerwall-Partnern, bekommen Coins, zahlen sie aus.
Alle Aufgaben stehen priorisiert in `AUFGABEN.md` — dort von oben nach unten arbeiten.

## Stack & Dateien

- Node 18+, ESM (`"type": "module"`), Express, PostgreSQL 15+ — kein TypeScript, kein ORM
- `server.js` — Partner-Postbacks, Auszahlungen, Betrugserkennung (16 Regeln + harte Sperren)
- `auth.js` — Registrierung, Login, Apple-Login, E-Mail/SMS-Codes, Token-Rotation, Kontolöschung
- `db.js` — einzige Stelle mit SQL; exportiert `db` und `hash()`
- `schema.sql` — Tabellen; einspielen mit `psql "$DATABASE_URL" -f schema.sql`
- `CoinCurb.jsx` — React-Frontend (eine Datei, eigenes CSS, kein Tailwind); läuft aktuell mit Demo-Daten
- Start: `npm install && npm start` — bricht ohne gültige `.env` bewusst ab (siehe `.env.example`)

## Unumstößliche Regeln

1. **1.000 Coins = 1,00 €.** Nirgends anders umrechnen.
2. **Jede Geldbewegung ist eine neue Zeile in `buchungen`.** Niemals Beträge per UPDATE ändern. Guthaben ist immer die Summe, gelesen über die View `guthaben`.
3. Buchungs-Status nur: `haltefrist | frei | zurueckgehalten | storniert`. `zurueckgehalten` (Schattensperre) wird NIE automatisch frei — nur von Hand.
4. **Nutzer-ID nie aus Body/Query nehmen**, immer aus `req.nutzer.id` (Middleware `angemeldet`). Die Auszahlungsroute war genau deshalb schon einmal kritisch verwundbar.
5. Telefonnummern, Auszahlungsziele, IPs: nur als `hash()` speichern bzw. verschlüsselt, nie loggen. Secrets nur in `.env`, nie in Code, Logs oder Fehlermeldungen.
6. Postbacks: Signatur zuerst prüfen, `(partner, partner_tx)` ist unique (Replay-Schutz), Antwort an Partner immer `200 "ok"` — auch bei Duplikaten und unbekannter Nutzer-ID.
7. Auszahlung: erst Minus-Buchung, dann Endstand prüfen, bei < 0 zurückdrehen (Schutz vor Doppelanfragen). Diese Reihenfolge nicht „optimieren".
8. Fehlermeldungen an Nutzer auf Deutsch, per Du, ohne Technik-Details. Interne Kommentare bleiben im Stil der bestehenden Dateien (Deutsch).
9. Betrugsregeln (`REGELN` in server.js): Gewichte nur ändern, wenn die Aufgabe es verlangt. Neue Kennzahlen in `db.kennzahlenFuer` ergänzen, Standardwert immer „unauffällig".
10. Nichts von Apple/Google-Richtlinien Relevantes entfernen: Kontolöschung, Altersgrenze 16+, iOS-Build ohne belohnte App-Installationen (nur Umfragen/Web-Angebote).

## Prüfen nach jeder Änderung

```
node --check server.js auth.js db.js
npm test        # sobald Aufgabe 14 (Tests) erledigt ist
```
