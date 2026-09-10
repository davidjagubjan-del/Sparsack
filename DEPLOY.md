# DEPLOY.md — CoinCurb live bringen

Übergabe an die Person, die das Ganze online stellt. Alles Technische steht hier, alles Geschäftliche
(Gewerbe, Verträge, Rechtstexte, Konten bei den Diensten) macht der Betreiber selbst, siehe `FAHRPLAN.md`.

## 1. Was das ist

CoinCurb besteht aus drei Teilen. Nur einer davon wird „hochgeladen", die anderen beiden müssen laufen:

| Teil | Was | Wo läuft es |
|---|---|---|
| **Backend** | Node-Programm (`server.js`), Express, alle Secrets | Dauerhaft laufender Node-Prozess, z. B. Railway, Render, Fly.io oder ein Linux-Server mit Node 18+ |
| **Datenbank** | PostgreSQL 15+ mit den Erweiterungen `pgcrypto` und `citext` | Managed Postgres beim selben Anbieter oder eigener Server |
| **App / Webseite** | Statische Dateien aus `app/dist` (React, gebaut mit Vite) | Beliebiger Webspace, Netlify, Cloudflare Pages, oder derselbe Server |

Die App spricht nur per HTTPS mit dem Backend. Das Backend spricht mit der Datenbank und mit den Diensten
(Partner, PayPal, Tango, Resend, Twilio, IPQualityScore). Ohne laufendes Backend ist die Webseite nur eine Hülle.

Empfohlene Aufteilung: `https://api.deine-domain.de` → Backend, `https://app.deine-domain.de` (oder die Hauptdomain) → App.

## 2. Reihenfolge

1. Datenbank anlegen und Schema einspielen
2. Backend mit Minimal-`.env` starten, `GET /gesund` und `GET /api/ich` prüfen
3. App bauen und hochladen, Registrierung im Browser durchspielen
4. Admin-Bereich aufrufen
5. Dienste einzeln freischalten, sobald der Betreiber die Zugangsdaten hat (Partner, Mail, SMS, Auszahlungen)
6. Erst dann Nutzer einladen

## 3. Datenbank

```
psql "$DATABASE_URL" -f schema.sql
```

Das Skript legt auch die Erweiterungen an; dafür braucht der Datenbank-Nutzer beim ersten Mal Superuser-Rechte,
oder ein Admin führt vorher einmal `CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;` aus.
Bei Railway/Render/Neon/Supabase geht `schema.sql` direkt durch.

**Bei späteren Updates** nur die neuen Dateien aus `migrationen/` der Reihe nach einspielen, `schema.sql` nie
ein zweites Mal (es legt Tabellen neu an). Migration 003 braucht den Schlüssel als Parameter:

```
psql "$DATABASE_URL" -v ziel_schluessel="$ZIEL_SCHLUESSEL" -f migrationen/003_ziel_verschluesseln.sql
```

Backups: tägliches Backup der Datenbank einschalten. In `buchungen` steht das Geld, das darf nie verloren gehen.

## 4. Backend

Start-Befehl beim Hoster: `npm install` und dann `npm start` (Node 18 oder neuer, Feld `engines` in `package.json`).
Health-Check-Pfad: `/gesund` (200 = läuft und Datenbank antwortet, 503 = Datenbank weg).
Der Prozess muss dauerhaft laufen, er erledigt im Hintergrund die Haltefrist (jede Minute) und die
Nachprüfung laufender PayPal-Auszahlungen (alle 5 Minuten). Genau **eine** Instanz betreiben, keine Autoscaling-Kopien,
solange nicht geklärt ist, dass beide Hintergrundjobs mehrfach unproblematisch sind.

Der Server steht hinter dem Proxy des Hosters (`trust proxy` ist gesetzt). Das ist nötig, damit IP-Allowlist,
Rate-Limits und VPN-Erkennung die echte Nutzer-IP sehen.

### 4.1 Minimal-`.env` für den ersten Start (ohne Partner und Dienste)

Vorlage ist `.env.example`. Ohne diese Werte startet das Backend absichtlich nicht:

```
DATABASE_URL=postgres://...
JWT_SECRET=<openssl rand -base64 48>
HASH_PEPPER=<openssl rand -base64 48>       # nach dem Start NIE mehr ändern
ZIEL_SCHLUESSEL=<openssl rand -base64 48>   # nach dem Start NIE mehr ändern
APP_URL=https://app.deine-domain.de
POSTBACK_BASIS=https://api.deine-domain.de
CORS_ORIGINS=https://localhost,capacitor://localhost
ADMIN_PASSWORT=<mindestens 16 Zeichen>
USD_EUR=0.90
PORT=3000                                    # bei Railway/Render den Wert des Hosters nehmen bzw. weglassen
```

Warum die drei „nie ändern"-Werte: `HASH_PEPPER` steckt in jedem gespeicherten Hash (Telefonnummern, IPs,
Sperrliste), `ZIEL_SCHLUESSEL` verschlüsselt die Auszahlungsziele. Ändert man sie, sind alte Daten unlesbar.
Alle drei sicher aufbewahren (Passwortmanager), nicht nur beim Hoster.

### 4.2 Alles, was später dazukommt

Die Zugangsdaten holt der Betreiber, der Techniker trägt sie ein. Jede Zeile ist einzeln zuschaltbar:

| Bereich | Variablen | Wirkung, wenn leer |
|---|---|---|
| Partner-Postbacks | `ADGATE_SECRET`, `AYET_SECRET`, `TOROX_SECRET`, `LOOTABLY_SECRET`, `BITLABS_SECRET`, `CPX_SECRET` | Partner-Postbacks werden mit 403 abgewiesen |
| Partner-Wände in der App | `ADGATE_WALL_ID`, `AYET_PLACEMENT`, `TOROX_OFFERWALL_ID`, `LOOTABLY_PLACEMENT`, `BITLABS_TOKEN`, `CPX_APP_ID` | Partner erscheint nicht in der App |
| Partner-IP-Listen | `<PARTNER>_IPS` | Jede IP darf (bei Torox und CPX unbedingt setzen, deren Hash deckt den Betrag nicht ab) |
| Auszahlungswege | `AUSZAHLUNG_AKTIV=amazon,steam,paypal` | Keine Auszahlung möglich |
| PayPal | `PAYPAL_UMGEBUNG`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` | PayPal-Aufträge werden abgelehnt und zurückgebucht |
| Tango (Amazon, Steam) | `TANGO_UMGEBUNG`, `TANGO_PLATFORM`, `TANGO_KEY`, `TANGO_ACCOUNT`, `TANGO_CUSTOMER`, `TANGO_UTID_AMAZON`, `TANGO_UTID_STEAM` | Gutschein-Aufträge werden abgelehnt und zurückgebucht |
| Mail | `RESEND_KEY`, `MAIL_ABSENDER` | Keine Bestätigungsmails (Registrierung klappt trotzdem, Warnung im Log) |
| SMS | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_VERIFY_SID` | Telefon-Bestätigung antwortet 503, damit keine erste Auszahlung |
| Apple-Login | `APPLE_BUNDLE_ID` | Apple-Login antwortet 401 |
| VPN-Erkennung | `IPQS_KEY` | Netztyp bleibt „unbekannt", Regel greift nicht |

Erst `sandbox`, dann `live` bei PayPal und Tango. Jeder Wechsel auf `live` ist eine bewusste Entscheidung des Betreibers.

### 4.3 Prüfen nach dem Start

```
curl -i https://api.deine-domain.de/gesund          # 200 {"ok":true}
curl -i https://api.deine-domain.de/api/ich         # 401 "Bitte melde dich neu an." = richtig
curl -i https://api.deine-domain.de/api/ich -H "Origin: https://boese.example"   # 403
```

Danach im Browser `https://api.deine-domain.de/admin` mit Nutzer `admin` und `ADMIN_PASSWORT` öffnen. Die Seite
muss laden und „Nichts offen" zeigen.

## 5. App bauen und hochladen

```
cd app
npm install
echo "VITE_API_BASE=https://api.deine-domain.de" > .env
npm run build
```

Den Inhalt von `app/dist` komplett auf den Webspace legen (das ist der Teil, den man wirklich hochlädt).
Zwei Dinge müssen beim Webspace stimmen:

- **HTTPS** aktiv.
- **Alle Pfade auf `index.html`** umleiten (Single-Page-App). Der Link aus der Bestätigungsmail heißt
  `/bestaetigen?c=…` und muss die App laden. Bei Netlify eine `_redirects` mit `/* /index.html 200`,
  bei Cloudflare Pages passiert es automatisch, bei Apache eine `.htaccess` mit Rewrite auf `index.html`,
  bei nginx `try_files $uri /index.html;`.

`APP_URL` im Backend muss exakt die Adresse der App sein (mit `https://`, ohne Schrägstrich am Ende), sonst
blockt CORS die Aufrufe und die Mail-Links zeigen ins Leere.

Testlauf im Browser: registrieren, Tab „Konto" zeigt Verifizierung und Sicherheit, „Auszahlen" zeigt
„Noch keine Auszahlungsart freigeschaltet", solange `AUSZAHLUNG_AKTIV` leer ist. Abmelden und wieder anmelden.

## 6. Partner anschließen und den ersten Postback testen

Für jeden Partner steht die einzutragende Postback-URL in `README.md` Abschnitt 1. Secret in die `.env`,
öffentliche ID in die `.env`, Backend neu starten. Die meisten Anbieter haben im Dashboard einen
„Test-Postback"-Knopf. Danach:

```
SELECT id, art, coins, partner, partner_tx, status, frei_ab FROM buchungen ORDER BY id DESC LIMIT 5;
```

Steht dort eine Zeile mit `status = haltefrist`, funktioniert die Kette. Ohne Dashboard geht ein Handtest, hier CPX
(`user_id` ist die UUID eines registrierten Nutzers aus `SELECT id FROM nutzer`):

```
TX=test-$(date +%s)
SIG=$(printf "%s-%s" "$TX" "$CPX_SECRET" | md5sum | cut -d' ' -f1)
curl "https://api.deine-domain.de/postback/cpx?user_id=<UUID>&transaction_id=$TX&payout=1.00&status=1&signature=$SIG"
# Antwort muss "ok" sein; 1,00 USD → 0,90 € → 540 Coins (60 % für den Nutzer)
```

Postback-Fehler stehen nicht im Log (Secrets), sondern nur als Antwortcode: 403 = Signatur oder IP, 404 = Partner-Name
falsch, 400 = `transaction_id` oder `payout` fehlt.

## 7. Auszahlungen scharf schalten

1. Zuerst Sandbox: `PAYPAL_UMGEBUNG=sandbox` bzw. `TANGO_UMGEBUNG=sandbox` mit den Sandbox-Zugängen,
   `AUSZAHLUNG_AKTIV=amazon` (Gutscheine zuerst, siehe FAHRPLAN.md, Schritt 13).
2. Testnutzer: Telefon bestätigen (oder in der Datenbank `telefon_bestaetigt = TRUE` setzen), Guthaben per
   Test-Postback, Haltefrist in der Datenbank abkürzen (`UPDATE buchungen SET status='frei' WHERE nutzer_id='…'`).
3. In der App auszahlen. Dann prüfen:
   ```
   SELECT beleg_nr, methode, betrag_eur, status, anbieter_ref, erstellt FROM auszahlungen ORDER BY erstellt DESC;
   SELECT aktion, wer, details, erstellt FROM protokoll ORDER BY id DESC LIMIT 10;
   ```
   `ausgezahlt` mit `anbieter_ref` = geschafft. `abgelehnt` = Grund steht im Protokoll unter `auszahlung_fehler`,
   das Guthaben ist automatisch zurückgebucht.
4. PayPal-Aufträge bleiben zunächst `laeuft` und werden innerhalb von 5 Minuten nachgeprüft.
5. Erst wenn Sandbox sauber läuft: `live`-Zugänge, `PAYPAL_UMGEBUNG=live`, Neustart.

In den ersten zwei Wochen jede Auszahlung von Hand im Admin-Bereich freigeben, siehe FAHRPLAN.md Schritt 17.
Dafür reicht es, die Nutzer über `AUSZAHLUNG_AKTIV` freizuschalten; alles ab 30 Risikopunkten landet ohnehin in
der Prüfung, den Rest kann man vorerst mit einem hohen Mindestbetrag bremsen.

## 8. Betrieb

- **Logs** des Backends beim Hoster ansehen. Dort stehen keine Secrets und keine Nutzerdaten, nur Fehler.
- **Protokoll** in der Datenbank (`protokoll`) oder unten im Admin-Bereich: jede Sperre, Freigabe, Ablehnung,
  jeder Dienstfehler.
- **Kurs** `USD_EUR` monatlich anpassen (Partner zahlen in Dollar, Coins gibt es für Euro).
- **Updates**: `git pull`, `npm install`, neue Migrationen einspielen, Neustart. Vor jedem Update `npm test`
  gegen eine Test-Datenbank (`TEST_DATABASE_URL`, Name endet auf `_test`).
- **Secrets** nie ins Repository, nie in Chat oder Mail. `.env` liegt nur beim Hoster und im Passwortmanager.
- **App-Store-Builds** siehe README Abschnitt 7 (Capacitor). Für die Stores braucht es zusätzlich Icon, Screenshots,
  Testkonto mit Guthaben und die Angaben aus FAHRPLAN.md Schritt 15 und 16.

## 9. Was noch niemand mit echten Zugängen geprüft hat

Ehrliche Liste, damit der erste Test an der richtigen Stelle sucht:

- Alle Dienste (PayPal, Tango, Resend, Twilio, IPQualityScore, Apple) sind gegen die offizielle Dokumentation gebaut
  und mit nachgestellten Antworten getestet, aber noch nie gegen die echten Sandbox-Zugänge gelaufen.
- Die Torox-Postback-Doku war öffentlich nicht erreichbar; das Format ist vom Vorgänger OfferToro übernommen
  (`sig = md5(oid-user_id-secret)`). Nach der Freischaltung mit der Doku im Torox-Dashboard abgleichen.
- AdGate Media (heute Prodege) hat keinen Postback-Hash. Schutz ist der geheime `token` in der URL plus die
  dokumentierte IP-Liste. Wenn AdGate neue IPs bekommt, muss `ADGATE_IPS` nachgezogen werden.
- Der Android-Build lief nur bis `npx cap sync`, nicht auf einem Gerät.

## 10. Kontakt zum Code

`CLAUDE.md` erklärt Aufbau und die zehn Regeln, die beim Ändern gelten. `AUFGABEN.md` zeigt, was gebaut wurde.
`npm test` muss vor jeder Änderung grün sein (111 Tests).
