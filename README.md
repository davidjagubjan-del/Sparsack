# CoinCurb — was noch fehlt, damit es live geht

Zwei Dateien: `CoinCurb.jsx` ist die App, `server.js` das Backend. Alles Geheime gehört ins Backend, nie ins Frontend.

## 0. Lokal starten

```
cp .env.example .env            # DATABASE_URL, JWT_SECRET und HASH_PEPPER befuellen (je 32+ Zeichen)
createdb coincurb               # oder: CREATE DATABASE coincurb; in psql
psql "$DATABASE_URL" -f schema.sql
npm install && npm start        # laedt die .env selbst; ohne gueltige .env bricht der Start ab
```

Kurzer Test per curl:

```
curl -i localhost:3000/api/ich                                   # -> 401
curl -X POST localhost:3000/api/registrieren -H 'content-type: application/json' \
     -d '{"email":"du@example.com","passwort":"mindestens10zeichen"}'   # -> zugang + refresh
curl localhost:3000/api/ich -H "authorization: Bearer <zugang>"  # -> Name, Coins, Werbecode
```

Die Extensions `pgcrypto` und `citext` legt `schema.sql` selbst an; dafuer braucht der DB-Nutzer beim ersten Einspielen Superuser-Rechte, oder du legst sie vorher einmal als `postgres` an.

Bestehende Datenbank nach einem Update: die Dateien in `migrationen/` der Reihe nach einspielen.

Tests: zweite Datenbank anlegen (`createdb coincurb_test`), `TEST_DATABASE_URL` in die `.env`, dann `npm test`.
Die Test-Datenbank wird bei jedem Lauf geleert und aus `schema.sql` neu aufgebaut.

## 1. Partner eintragen

Oben in `CoinCurb.jsx` bei `PARTNER` die **Publisher-ID** einsetzen (öffentlich, darf im Frontend stehen). Das **Secret** kommt in die `.env` des Backends.

| Anbieter | Anmeldung | Was du brauchst |
|---|---|---|
| AdGate Media | adgatemedia.com | Wall-ID + Postback-Secret |
| AyeT Studios | ayetstudios.com | Placement-ID + Secret |
| Torox | torox.io | Offerwall-ID + Secret |
| Lootably | lootably.com | Placement-ID + API-Key |
| BitLabs | bitlabs.ai | App-Token |
| CPX Research | cpx-research.com | App-ID + Secure-Hash |

Postback-URL je Anbieter im Dashboard eintragen (`https://api.deine-domain.de` = `POSTBACK_BASIS` aus der `.env`).
Die Platzhalter sind die des jeweiligen Anbieters, die Signaturpruefung steht in `server.js` bei `PARTNER`:

| Anbieter | Postback-URL (an `POSTBACK_BASIS` anhaengen) | Pruefung |
|---|---|---|
| AdGate Media | `/postback/adgate?token=<ADGATE_SECRET>&user_id={s1}&transaction_id={conversion_id}&payout={payout}&offer_name={offer_name}&state={state}` | kein Hash: geheimer `token` + IP-Liste |
| AyeT Studios | `/postback/ayet?user_id={external_identifier}&transaction_id={transaction_id}&payout={payout_usd}&offer_name={offer_name}&chargeback={is_chargeback}` | Header `X-Ayetstudios-Security-Hash`, HMAC-SHA256 mit API-Key |
| Torox | `/postback/torox` (Torox haengt `id, oid, user_id, payout, o_name, sig` selbst an) | `sig = md5(oid-user_id-secret)` |
| Lootably | `/postback/lootably?user_id={userID}&transaction_id={transactionID}&ip={ip}&payout={revenue}&reward={currencyReward}&offer_name={offerName}&status={status}&signature={hash}` | `sha256(userID+ip+revenue+currencyReward+secret)`, Antwort `1` |
| BitLabs | `/postback/bitlabs?user_id=[%USER:UID%]&transaction_id=[%TX%]&payout=[%VALUE:USD%]&type=[%ACTIVITY:TYPE%]&ref=[%REF%]&offer_name=[%OFFER:NAME%]` | `&hash` = HMAC-SHA1 ueber die komplette URL |
| CPX Research | `/postback/cpx?user_id={user_id}&transaction_id={trans_id}&payout={amount_usd}&status={status}&signature={secure_hash}` | `md5(trans_id-securehash)` |

Alle melden den Payout in US-Dollar; `USD_EUR` in der `.env` rechnet um, davon bekommt der Nutzer 60 % als Coins.
Rueckbuchungen erkennt der Server am jeweiligen Partner-Signal (`state=rejected`, `is_chargeback=1`, negativer Payout,
`status=0`, `ACTIVITY:TYPE=RECONCILIATION`, `status=2`); zusaetzlich gibt es `/postback/<anbieter>/storno`.

Fast alle verlangen vor Freischaltung eine erreichbare Webseite, Impressum, Datenschutzerklärung und AGB. Ohne Gewerbe bekommst du keine Verträge.

## 2. Auszahlungen freischalten

In `CoinCurb.jsx` bei `PAYOUTS` auf `aktiv: true` setzen, im Backend die Zugangsdaten hinterlegen.

- **PayPal Payouts** — Business-Konto, API-Freischaltung beantragen
- **Amazon / Steam / Google Play** — über Tango Card oder Giftbit, nie direkt
- **SEPA** — Wise Business oder Stripe Connect
- **Krypto** — Coinbase Commerce oder BitPay

## 3. Betrugserkennung — so ist sie gebaut

**Harte Sperren** (sofort, kein Ermessen): gesperrtes Gerät, gesperrte Auszahlungsadresse, Ausweis schon vergeben, Altersgrenze.

**Punktesystem 0–100**, Regeln in `server.js`:

| Bereich | Beispiele |
|---|---|
| Gerät & Netz | zweites Konto auf demselben Gerät (45), VPN oder Server-IP (30), Emulator (40) |
| Verhalten | unrealistisch schnelle Abschlüsse (35), immer gleiche Zeitabstände = Bot (20), über 14 Std ohne Pause (15), nur die teuersten Angebote (10) |
| Geld | junges Konto mit hohem Verdienst (25), hohe Storno-Quote (30), geteilte PayPal-Adresse (50) |
| Einladungen | Eingeladene teilen Gerät (45), viele tote Einladungen (20) |

Daraus folgt die Behandlung:

- **unter 30** → normal, 72 Stunden Haltefrist, Auszahlung automatisch
- **30–59** → 7 Tage Haltefrist
- **60–79** → manuelle Freigabe, Ausweis
- **ab 80** → gesperrt, Schattensperre (App läuft weiter, Auszahlung nicht)

Die Verhaltenswerte brauchen den Aufgabenstart aus der App: vor dem Öffnen eines Angebots `POST /api/aufgabe/start`
mit `{ partner, angebot, erwarteteDauerSek }`. Daraus entstehen Dauer je Abschluss (verglichen mit anderen Nutzern
desselben Angebots), Taktung, Stunden am Stück und der Anteil teurer Angebote.

**Vier Schichten, die unabhängig davon immer greifen:**

1. **Haltefrist** — jede Gutschrift ist 72 Std gesperrt. Zieht der Partner die Buchung zurück, wird sie abgezogen, bevor Geld raus ist. Das rettet dir die Marge.
2. **Postback-Härtung** — Signaturprüfung, IP-Allowlist, `transaction_id` nur einmal verwertbar. Ohne das ruft dich jemand mit gefälschten Gutschriften leer.
3. **Stufen-Verifizierung** — Telefonnummer vor der ersten Auszahlung, Ausweis ab 100 € im Monat, Tageslimit 50 €.
4. **Protokoll + Widerruf** — jede Sperre ist einsehbar und mit einem Klick rücknehmbar. Fehlalarme kosten dich echte Nutzer und 1-Sterne-Bewertungen.

Zusätzlich einkaufen statt selbst bauen: **Proxy-Erkennung** (IPQualityScore, ipdata) und **Geräte-Fingerprint** (FingerprintJS Pro). Die eigene Erkennung ist gut genug für Gelegenheitsbetrug, nicht für Farmen mit hundert Geräten.

## 4. Was noch fehlt

Login und Konten, Datenbank (Postgres), Rechtstexte, App-Store-Freigabe (Apple verlangt bei Reward-Apps genaue Angaben zur Auszahlung), Support-Postfach. Die Coin-Umrechnung steht auf 60 % der Partner-Einnahme für den Nutzer — das ist der marktübliche Bereich.
