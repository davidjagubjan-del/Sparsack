# CoinCurb — Fahrplan

## Teil 1: Was jetzt fertig ist

| Datei | Inhalt |
|---|---|
| `CoinCurb.jsx` | Die komplette Oberfläche |
| `server.js` | Postbacks, Auszahlungen, Betrugserkennung |
| `auth.js` | Registrierung, Login, Apple-Login, E-Mail- und SMS-Bestätigung, Kontolöschung |
| `db.js` | Datenbankschicht mit allen Abfragen |
| `schema.sql` | Die Tabellen für Postgres |

## Teil 2: Was noch fehlt

**Ohne das läuft gar nichts:**

1. **Gewerbe oder UG.** Kein Partner und kein Zahlungsdienst arbeitet mit Privatpersonen. Bei UG rechne mit rund 500–800 € Gründungskosten.
2. **Server + Datenbank.** Railway, Render oder Hetzner. 10–30 € im Monat.
3. **Domain + Webseite.** Anbieter prüfen, ob es dich wirklich gibt.
4. **Rechtstexte.** Impressum, Datenschutzerklärung, AGB mit klaren Regeln zu Guthaben, Haltefrist und Sperren. Vom Anwalt oder von einem geprüften Generator. Ohne AGB verlierst du jeden Streit um ein gesperrtes Konto.
5. **Apple Developer Account.** 99 $ im Jahr, Freischaltung dauert bei Firmen 1–2 Wochen (D-U-N-S-Nummer nötig).
6. **Google Play Developer Account.** 25 $ einmalig.

**Damit Geld fließt:**

7. Verträge mit mindestens 2 Offerwall-Anbietern (Zusage dauert 2 Tage bis 3 Wochen).
8. PayPal-Business mit freigeschalteter Payouts-API, oder Tango Card für Gutscheine.
9. Startkapital für die Auszahlungen. Die Partner zahlen dir monatlich, deine Nutzer wollen sofort Geld. Rechne mit 500–2.000 € Vorlauf.

**Damit die App nicht abgelehnt wird:**

10. Kontolöschung in der App (ist eingebaut, muss sichtbar sein).
11. Testkonto für die Prüfer bei Apple und Google, mit Guthaben, damit sie die Auszahlung sehen können.
12. Altersfreigabe 16+/18+, Datenschutz-Angaben im Store-Formular.
13. App-Icon, Screenshots, Beschreibung.

**Später, aber wichtig:**

14. Push-Nachrichten, Support-Postfach, Buchhaltung, Steuerberater, Admin-Bereich zum Freigeben von Auszahlungen.

---

## Teil 3: Schritt für Schritt

### Woche 1 — Anmelden und aufsetzen

**Schritt 1.** Geh zum Gewerbeamt deiner Stadt (viele Städte online) und melde ein Gewerbe an: „Betrieb einer Online-Plattform und Onlinewerbung". Kostet 20–60 €. Du bekommst den Gewerbeschein per Post.

**Schritt 2.** Kauf eine Domain, zum Beispiel bei Namecheap oder INWX. 10 € im Jahr.

**Schritt 3.** Leg ein Konto bei **Railway.app** an. Klick „New Project" → „Deploy PostgreSQL". Kopier die Zeile `DATABASE_URL` aus den Einstellungen.

**Schritt 4.** Öffne ein Terminal und tippe:
```
psql "DEINE_DATABASE_URL" -f schema.sql
```
Damit stehen alle Tabellen.

**Schritt 5.** Leg im Projektordner eine Datei `.env` an:
```
DATABASE_URL=...
JWT_SECRET=<32 zufällige Zeichen>
HASH_PEPPER=<32 zufällige Zeichen>
APP_URL=https://deine-domain.de
```
Diese Datei kommt **nie** auf GitHub.

**Schritt 6.** Server hochladen: `npm i express pg argon2 jsonwebtoken express-rate-limit`, dann in Railway „Deploy from GitHub". Ruf `https://deine-domain.de/api/ich` auf — wenn „Bitte melde dich neu an" kommt, läuft alles richtig.

### Woche 1–2 — Rechtstexte und Konten

**Schritt 7.** Impressum, Datenschutz und AGB erstellen lassen und auf die Webseite stellen. In den AGB müssen stehen: 72-Stunden-Haltefrist, Rückbuchung bei Storno, Sperre bei Mehrfachkonten, kein Anspruch auf Auszahlung bei Betrug.

**Schritt 8.** Beantrage eine **D-U-N-S-Nummer** (kostenlos, 5–10 Werktage). Ohne sie gibt es keinen Firmen-Account bei Apple.

**Schritt 9.** Melde dich an bei:
- developer.apple.com → Apple Developer Program (99 $)
- play.google.com/console (25 $)
- PayPal Business → Payouts-API beantragen

### Woche 2–3 — Partner eintragen

**Schritt 10.** Bewirb dich bei **zwei** Anbietern gleichzeitig. Am schnellsten sind erfahrungsgemäß die Umfrage-Anbieter:
- bitlabs.ai
- cpx-research.com
- ayetstudios.com
- lootably.com

Im Bewerbungsformular brauchst du: Firmenname, Webseite, wie du Nutzer gewinnst, erwartete Nutzerzahl. Schreib ehrlich „neue App, Start in Deutschland" — Übertreiben fliegt beim ersten Traffic-Check auf.

**Schritt 11.** Sobald ein Anbieter zusagt, im Dashboard eintragen:
```
https://deine-domain.de/postback/<anbieter>?user_id={user_id}&transaction_id={txid}&payout={payout}&signature={hash}
```
Secret aus dem Dashboard in die `.env`, Publisher-ID oben in `CoinCurb.jsx` bei `PARTNER`.

**Schritt 12.** Testen: Der Anbieter hat meist einen „Test-Postback"-Knopf. Drück ihn und schau in die Datenbank:
```
SELECT * FROM buchungen ORDER BY id DESC LIMIT 5;
```
Steht da eine Zeile mit Status `haltefrist`, funktioniert die Kette.

**Schritt 13.** In `CoinCurb.jsx` bei `PAYOUTS` die freigeschalteten Wege auf `aktiv: true` setzen. Fang mit **Amazon-Gutscheinen** an, nicht mit PayPal — die Freischaltung geht schneller und Missbrauch tut weniger weh.

### Woche 3–4 — App bauen und einreichen

**Schritt 14.** Aus dem Web-Code eine echte App machen. Der schnellste Weg ist **Capacitor**:
```
npm create vite@latest coincurb -- --template react
npm i @capacitor/core @capacitor/cli
npx cap init
npm run build && npx cap add ios && npx cap add android
```
`CoinCurb.jsx` als Hauptkomponente einsetzen.

**Schritt 15.** **Zuerst Google Play.** Prüfung dauert meist 1–3 Tage, die Regeln sind lockerer. Lade den Build hoch, fülle das Datenschutzformular aus, Altersfreigabe auf 16+.

**Schritt 16.** Dann Apple. Vorher zwingend:
- Testkonto mit 20 € Guthaben anlegen und die Zugangsdaten in „Notes for Review" schreiben
- Kontolöschung in der App sichtbar machen (Konto → Konto löschen)
- Ein Video oder klare Notiz, wie das Auszahlen funktioniert

**Wichtig:** Apple lehnt Angebote ab, bei denen Nutzer fürs **Installieren anderer Apps** oder für Bewertungen bezahlt werden. Genau das ist die häufigste Ablehnung in dieser Kategorie. Starte deshalb im ersten iOS-Build nur mit **Umfragen und Web-Angeboten**, nicht mit App-Installationen. Für Android kannst du die vollen Offerwalls anschalten.

**Schritt 17.** Nach der Freigabe: Erste 20 Nutzer über Freunde, TikTok oder Reddit holen. Schau eine Woche lang täglich in die Tabelle `risiko_verlauf` und `auszahlungen`. Jede Auszahlung in den ersten zwei Wochen von Hand freigeben, egal was die Punkte sagen.

---

## Realistischer Zeitplan

| | |
|---|---|
| Gewerbe, Server, Rechtstexte | 1–2 Wochen |
| Partner-Zusagen | 1–3 Wochen (läuft parallel) |
| Google Play live | ab Woche 3 |
| Apple live | Woche 4–8, oft nach 1–2 Ablehnungen |

„Sofort Geld verdienen" gibt es hier nicht: Die Anbieter zahlen dir **monatlich** aus, meist 30 Tage nach Monatsende. Deine ersten Auszahlungen an Nutzer musst du also aus eigener Tasche vorstrecken. Plane 500–2.000 € ein und setze das Mindestauszahlungslimit anfangs auf 5 €, nicht niedriger.

## Der schnellste Start überhaupt

Wenn du in **drei Tagen** live sein willst: lass die Stores erstmal weg. Stell die App als Webseite online, schalte einen Umfrage-Anbieter frei und zahle per Amazon-Gutschein aus. Damit siehst du in einer Woche, ob Leute die App überhaupt benutzen — bevor du 99 $, D-U-N-S und Wochen an Store-Prüfung investierst.
