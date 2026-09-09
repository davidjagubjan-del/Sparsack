# AUFGABEN.md — Reihenfolge für Claude Code

Von oben nach unten. Jede Aufgabe einzeln übergeben, z. B.:
„Erledige Aufgabe 3 aus AUFGABEN.md. Halte dich an CLAUDE.md."
Nach jeder Aufgabe: Haken setzen, committen.

---

## Block A — Fundament (vor allem anderen)

**[x] 1. Projekt lauffähig machen**
`.env` aus `.env.example` befüllen, `npm install`, Schema in eine lokale Postgres einspielen, `npm start`.
Fertig wenn: `GET /api/ich` ohne Token `401` liefert und Registrierung → Login per curl durchläuft.

**[x] 2. helmet + CORS**
`helmet` einbauen, CORS nur für `APP_URL` erlauben, `express.json({ limit: "50kb" })`.
Fertig wenn: Anfrage von fremder Origin blockiert wird, Security-Header in der Antwort stehen.

**[x] 3. IP-Allowlist echt machen**
`imNetz()` in server.js ist eine Attrappe (gibt immer true). Mit `ip-range-check` implementieren, IPv6-fähig.
Fertig wenn: Postback von nicht gelisteter IP bei gesetzter Allowlist `403` bekommt; leere Liste weiter alles erlaubt.

**[x] 4. Tests aufsetzen (vitest + supertest)**
Mindestens: Postback gültig/ungültige Signatur/Duplikat, Auszahlung ohne Login → 401, Doppelanfrage → eine wird 409, Storno bucht zurück, Tageslimit greift.
Fertig wenn: `npm test` grün läuft. (Früh machen — alle weiteren Aufgaben bauen darauf.)

## Block B — Geld rein (je Partner eine Aufgabe)

**[x] 5. Partner-Signaturen exakt nach Anbieter-Doku**
Die drei generischen Signatur-Varianten in `signaturOk()` durch je eine geprüfte Implementierung pro Partner ersetzen (AdGate, AyeT, Torox, Lootably, BitLabs, CPX). Webrecherche in der jeweiligen Postback-Doku, Parameter-Namen der Anbieter auf unsere Query-Namen mappen.
Fertig wenn: pro Partner ein Test mit einem Beispiel-Postback aus der Doku grün ist.

**[x] 6. Verhaltens-Kennzahlen füllen**
Aufgabenstart clientseitig melden (`POST /api/aufgabe/start`), Tabelle dafür ergänzen, in `db.kennzahlenFuer` echte Werte für `medianDauerSek`, `gleicheAbstaende`, `stundenAmStueck`, `anteilHighPayout` berechnen.
Fertig wenn: Regeln `zu_schnell` und `taktung` in Tests mit konstruierten Daten anschlagen.

**[x] 7. VPN-/Proxy-Erkennung**
`netzTyp()` in auth.js an IPQualityScore (oder ipdata) anbinden, Ergebnis cachen (24 h), Ausfall des Dienstes = „unbekannt", nie blockieren.
Fertig wenn: bekannte Datacenter-IP als `rechenzentrum` erkannt wird und die Regel `vpn` Punkte vergibt.

## Block C — Geld raus

**[ ] 8. PayPal Payouts**
`PAYOUTS.paypal.senden()` gegen die Payouts-API implementieren (Sandbox), `anbieter_ref` und Status `ausgezahlt`/`abgelehnt` zurückschreiben, Fehler in `protokoll`.
Fertig wenn: Sandbox-Auszahlung durchläuft und der Beleg in `auszahlungen` den PayPal-Batch verweist.

**[ ] 9. Gutscheine über Tango Card**
`PAYOUTS.amazon.senden()` + Steam analog. Gutschein-Code NICHT in der DB speichern, nur Referenz; Zustellung per Mail.
Fertig wenn: Sandbox-Bestellung durchläuft.

**[ ] 10. Auszahlungsziele verschlüsseln**
Spalte `ziel` mit pgcrypto (`pgp_sym_encrypt`) ablegen, Schlüssel aus `.env`, Entschlüsselung nur in `senden()`. `ziel_hash` bleibt für die Mehrfachkonto-Prüfung.
Fertig wenn: `SELECT ziel FROM auszahlungen` nur Ciphertext zeigt, Auszahlung trotzdem funktioniert.

## Block D — Anbindung & Versand

**[ ] 11. Mail + SMS echt versenden**
`mail.senden` über Resend, `sms.senden` über Twilio Verify oder MessageBird. Absender/Keys aus `.env`.
Fertig wenn: Registrierungs-Mail und SMS-Code real ankommen (Test-Modus der Dienste reicht).

**[ ] 12. Apple Sign-In prüfen**
`appleTokenPruefen()` mit `jose` gegen `https://appleid.apple.com/auth/keys` implementieren, `aud` (Bundle-ID aus `.env`) und `iss` prüfen.
Fertig wenn: manipuliertes Token abgelehnt, gültiges Sandbox-Token akzeptiert wird.

**[ ] 13. Frontend an die API anbinden**
In `CoinCurb.jsx` einen fetch-Layer bauen (Login-Screen, Token-Refresh, `API_BASE` aus Config). Demo-Daten nur noch als Fallback, wenn `API_BASE` leer ist. Screens auf `/api/ich`, `/api/security`, `/api/walls`, `/api/auszahlung` umstellen.
Fertig wenn: kompletter Durchlauf Registrieren → Aufgabe (Test-Postback) → Guthaben sichtbar → Auszahlung angefordert im Browser klappt.

**[ ] 14. Admin-Bereich (minimal)**
Eigene Routen unter `/admin` mit separatem Passwort (`.env`): offene Auszahlungen mit Risiko-Treffern listen, freigeben/ablehnen, Konto sperren/entsperren, Sperrlisten-Eintrag. Jede Aktion in `protokoll`.
Fertig wenn: eine Auszahlung mit Status `pruefung` per Klick freigegeben werden kann.

## Block E — In die Stores

**[ ] 15. Capacitor-Projekt**
Vite-Projekt um `CoinCurb.jsx` bauen, Capacitor für iOS + Android, Geräte-Fingerprint (`x-device-id`) und Plattform-Header aus dem nativen Kontext setzen.
Fertig wenn: Android-Debug-Build auf einem Gerät läuft.

**[ ] 16. iOS-Variante ohne belohnte App-Installationen**
Feature-Flag: auf iOS nur Umfrage-Partner (BitLabs, CPX) anzeigen, Offerwalls mit App-Install-Angeboten ausblenden. Grund: Apple-Review, siehe FAHRPLAN.md.
Fertig wenn: derselbe Build je Plattform unterschiedliche Anbieter zeigt.

---

Bewusst NICHT automatisierbar (macht der Betreiber selbst): Gewerbe, Rechtstexte, Partner-Verträge, D-U-N-S, Store-Konten, Auszahlungs-Startkapital — Ablauf in FAHRPLAN.md.
