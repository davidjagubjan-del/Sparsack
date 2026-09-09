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

Bei jedem Anbieter im Dashboard eintragen:
`https://api.deine-domain.de/postback/<anbieter>?user_id={user_id}&transaction_id={txid}&payout={payout}&signature={hash}`

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
| Verhalten | unrealistisch schnelle Abschlüsse (35), immer gleiche Zeitabstände = Bot (20) |
| Geld | junges Konto mit hohem Verdienst (25), hohe Storno-Quote (30), geteilte PayPal-Adresse (50) |
| Einladungen | Eingeladene teilen Gerät (45), viele tote Einladungen (20) |

Daraus folgt die Behandlung:

- **unter 30** → normal, 72 Stunden Haltefrist, Auszahlung automatisch
- **30–59** → 7 Tage Haltefrist
- **60–79** → manuelle Freigabe, Ausweis
- **ab 80** → gesperrt, Schattensperre (App läuft weiter, Auszahlung nicht)

**Vier Schichten, die unabhängig davon immer greifen:**

1. **Haltefrist** — jede Gutschrift ist 72 Std gesperrt. Zieht der Partner die Buchung zurück, wird sie abgezogen, bevor Geld raus ist. Das rettet dir die Marge.
2. **Postback-Härtung** — Signaturprüfung, IP-Allowlist, `transaction_id` nur einmal verwertbar. Ohne das ruft dich jemand mit gefälschten Gutschriften leer.
3. **Stufen-Verifizierung** — Telefonnummer vor der ersten Auszahlung, Ausweis ab 100 € im Monat, Tageslimit 50 €.
4. **Protokoll + Widerruf** — jede Sperre ist einsehbar und mit einem Klick rücknehmbar. Fehlalarme kosten dich echte Nutzer und 1-Sterne-Bewertungen.

Zusätzlich einkaufen statt selbst bauen: **Proxy-Erkennung** (IPQualityScore, ipdata) und **Geräte-Fingerprint** (FingerprintJS Pro). Die eigene Erkennung ist gut genug für Gelegenheitsbetrug, nicht für Farmen mit hundert Geräten.

## 4. Was noch fehlt

Login und Konten, Datenbank (Postgres), Rechtstexte, App-Store-Freigabe (Apple verlangt bei Reward-Apps genaue Angaben zur Auszahlung), Support-Postfach. Die Coin-Umrechnung steht auf 60 % der Partner-Einnahme für den Nutzer — das ist der marktübliche Bereich.
