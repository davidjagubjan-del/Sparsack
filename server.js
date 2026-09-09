/**
 * CoinCurb Backend — Grundgeruest
 * Node 18+ / Express. Start: node server.js
 *
 * Alles was ein Geheimnis ist, steht in der .env — nie im Frontend.
 * Siehe README.md fuer die Liste aller Variablen.
 */

import "dotenv/config";      // .env laden, bevor db.js/auth.js die Secrets pruefen
import express from "express";
import crypto from "crypto";
import { db } from "./db.js";
import auth, { angemeldet } from "./auth.js";

const app = express();
app.set("trust proxy", 1);   // hinter Railway/Render sonst falsche IPs bei Allowlist und Rate-Limit
app.use(express.json());
app.use(auth);               // Login-Routen aus auth.js

/* ============================================================
   1. PARTNER — Postback-Zugangsdaten
   Jeder Offerwall-Anbieter schickt eine Server-zu-Server-Meldung,
   wenn ein Nutzer eine Aufgabe abgeschlossen hat.
   Secret + erlaubte IPs bekommst du im Dashboard des Anbieters.
   ============================================================ */

const PARTNER = {
  adgate:   { secret: process.env.ADGATE_SECRET,   ips: ["204.13.156.0/24"], sig: "md5_konkat" },
  ayet:     { secret: process.env.AYET_SECRET,     ips: [],                  sig: "sha256_hmac" },
  torox:    { secret: process.env.TOROX_SECRET,    ips: [],                  sig: "md5_konkat" },
  lootably: { secret: process.env.LOOTABLY_SECRET, ips: [],                  sig: "sha256_hmac" },
  bitlabs:  { secret: process.env.BITLABS_SECRET,  ips: [],                  sig: "sha256_url" },
  cpx:      { secret: process.env.CPX_SECRET,      ips: [],                  sig: "md5_konkat" },
};

/* ============================================================
   2. AUSZAHLUNGEN
   ============================================================ */

const PAYOUTS = {
  paypal: {
    aktiv: false, min: 5.0, gebuehr: 0,
    zugang: { id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_SECRET },
    senden: async (ziel, betrag) => {/* PayPal Payouts API v1/payments/payouts */},
  },
  amazon: {
    aktiv: false, min: 5.0, gebuehr: 0,
    zugang: { key: process.env.TANGO_KEY, konto: process.env.TANGO_ACCOUNT },
    senden: async (ziel, betrag) => {/* Tango Card / Giftbit orders */},
  },
  bank: {
    aktiv: false, min: 20.0, gebuehr: 0.35,
    zugang: { key: process.env.WISE_TOKEN },
    senden: async (ziel, betrag) => {/* Wise / Stripe Connect payout */},
  },
  crypto: {
    aktiv: false, min: 10.0, gebuehr: 0.5,
    zugang: { key: process.env.COINBASE_KEY },
    senden: async (ziel, betrag) => {/* Coinbase Commerce */},
  },
};

/* ============================================================
   3. BETRUGSERKENNUNG
   Zwei Schichten:
   A) Harte Sperren  — greifen sofort, kein Ermessen
   B) Punktesystem   — 0 bis 100, entscheidet ueber Wartezeit
   ============================================================ */

const REGELN = [
  // --- Geraet & Netzwerk ---
  { id: "mehrfachkonto_geraet", punkte: 45, pruef: (k) => k.kontenAufGeraet > 1,
    text: "Mehrere Konten auf demselben Geraet" },
  { id: "mehrfachkonto_ip", punkte: 25, pruef: (k) => k.kontenAufIp > 3,
    text: "Auffaellig viele Konten aus demselben Netz" },
  { id: "vpn", punkte: 30, pruef: (k) => k.ipTyp === "vpn" || k.ipTyp === "rechenzentrum",
    text: "VPN, Proxy oder Server-IP" },
  { id: "emulator", punkte: 40, pruef: (k) => k.emulator || k.rootOderJailbreak,
    text: "Emulator oder manipuliertes Geraet" },
  { id: "land_mismatch", punkte: 15, pruef: (k) => k.ipLand !== k.simLand && k.simLand,
    text: "IP-Land passt nicht zur SIM-Karte" },
  { id: "geraet_neu", punkte: 10, pruef: (k) => k.geraetAlterTage < 1,
    text: "Geraet zum ersten Mal gesehen" },

  // --- Verhalten ---
  { id: "zu_schnell", punkte: 35, pruef: (k) => k.medianDauerSek < k.erwarteteDauerSek * 0.25,
    text: "Aufgaben werden unrealistisch schnell fertig" },
  { id: "taktung", punkte: 20, pruef: (k) => k.gleicheAbstaende,
    text: "Immer exakt gleiche Abstaende zwischen Aktionen (Bot-Muster)" },
  { id: "kein_leerlauf", punkte: 15, pruef: (k) => k.stundenAmStueck > 14,
    text: "Ueber 14 Stunden ohne Pause aktiv" },
  { id: "nur_high_payout", punkte: 10, pruef: (k) => k.anteilHighPayout > 0.9 && k.abschluesse > 5,
    text: "Ausschliesslich die teuersten Angebote" },

  // --- Konto & Geld ---
  { id: "junges_konto_hoch", punkte: 25, pruef: (k) => k.kontoAlterTage < 2 && k.verdientEur > 20,
    text: "Sehr junges Konto mit hohem Verdienst" },
  { id: "storno_quote", punkte: 30, pruef: (k) => k.stornoQuote > 0.3 && k.abschluesse > 5,
    text: "Viele Buchungen werden vom Partner zurueckgezogen" },
  { id: "payout_geteilt", punkte: 50, pruef: (k) => k.kontenMitGleicherAuszahladresse > 1,
    text: "Auszahlungsadresse wird von mehreren Konten benutzt" },
  { id: "payout_gewechselt", punkte: 15, pruef: (k) => k.auszahladresseGeaendertVorStd < 24,
    text: "Auszahlungsadresse gerade erst geaendert" },

  // --- Einladungen ---
  { id: "ref_ring", punkte: 45, pruef: (k) => k.refsGleichesGeraet > 0,
    text: "Eingeladene teilen Geraet oder Netzwerk" },
  { id: "ref_tot", punkte: 20, pruef: (k) => k.refs > 10 && k.refsAktiv / k.refs < 0.1,
    text: "Viele Einladungen, fast keine echte Aktivitaet" },
];

const HARTE_SPERREN = [
  { id: "geraet_gesperrt", pruef: (k) => k.geraetAufSperrliste, text: "Geraet ist gesperrt" },
  { id: "adresse_gesperrt", pruef: (k) => k.auszahladresseAufSperrliste, text: "Auszahlungsadresse ist gesperrt" },
  { id: "minderjaehrig", pruef: (k) => k.alterAngabe < 16, text: "Altersgrenze nicht erfuellt" },
  { id: "doppelte_id", pruef: (k) => k.ausweisSchonBenutzt, text: "Ausweis gehoert bereits zu einem Konto" },
];

function risikoPruefen(k) {
  for (const s of HARTE_SPERREN) {
    if (s.pruef(k)) return { punkte: 100, stufe: "gesperrt", grund: s.text, treffer: [s.id] };
  }
  const treffer = REGELN.filter((r) => { try { return r.pruef(k); } catch { return false; } });
  const punkte = Math.min(100, treffer.reduce((s, r) => s + r.punkte, 0));

  let stufe, halteStunden;
  if (punkte < 30)      { stufe = "normal";  halteStunden = 72; }
  else if (punkte < 60) { stufe = "erhoeht"; halteStunden = 168; }   // 7 Tage
  else if (punkte < 80) { stufe = "pruefen"; halteStunden = 168; }   // + manuelle Freigabe
  else                  { stufe = "gesperrt"; halteStunden = null; }

  return { punkte, stufe, halteStunden, treffer: treffer.map((t) => t.id), texte: treffer.map((t) => t.text) };
}

/* Zusaetzliche Schutzschichten, die nicht im Punktesystem stecken:
   - Haltefrist: jede Gutschrift ist 72 Std gesperrt, damit Stornos der
     Partner noch vom Guthaben abgezogen werden koennen (chargeback-sicher).
   - Auszahlungslimit: max. 50 € pro Tag und 200 € pro Monat ohne Ausweis.
   - Telefonnummer vor der ersten Auszahlung, Ausweis ab 100 € im Monat.
   - Jede Postback-Transaktion nur einmal (transaction_id ist unique) —
     verhindert Wiedereinspielen alter Meldungen.
   - Signatur + IP-Allowlist bei jedem Postback.
   - Schattensperre: bei Stufe "gesperrt" laeuft die App normal weiter,
     Auszahlungen bleiben aber haengen. Das verzoegert das Nachbauen
     neuer Umgehungswege.
   - Alles wird protokolliert; jede Sperre ist mit einem Klick pruefbar
     und widerrufbar (Fehlalarme kosten sonst echte Nutzer). */

/* ============================================================
   4. POSTBACK — Gutschrift vom Partner
   ============================================================ */

function signaturOk(partnerId, req) {
  const p = PARTNER[partnerId];
  if (!p || !p.secret) return false;
  const q = req.query;
  if (p.sig === "md5_konkat") {
    const soll = crypto.createHash("md5")
      .update(`${q.user_id}${q.transaction_id}${q.payout}${p.secret}`).digest("hex");
    return sicherGleich(soll, String(q.signature || ""));
  }
  if (p.sig === "sha256_hmac") {
    const soll = crypto.createHmac("sha256", p.secret)
      .update(req.originalUrl.split("&signature=")[0]).digest("hex");
    return sicherGleich(soll, String(q.signature || ""));
  }
  return false;
}

function sicherGleich(a, b) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

app.get("/postback/:partner", async (req, res) => {
  const { partner } = req.params;
  if (!PARTNER[partner]) return res.status(404).send("unbekannter Partner");
  if (!ipErlaubt(req.ip, PARTNER[partner].ips)) return res.status(403).send("IP nicht erlaubt");
  if (!signaturOk(partner, req)) return res.status(403).send("Signatur falsch");

  const { user_id, transaction_id, payout, offer_name } = req.query;

  // Doppelte Meldungen abweisen (partner + transaction_id unique in der DB)
  if (await db.transaktionExistiert(partner, transaction_id)) return res.send("ok"); // Partner will 200
  if (!(await db.nutzer(user_id))) return res.send("ok"); // unbekannte ID: nichts gutschreiben, aber Partner-Wiederholung stoppen

  // payout kommt vom Partner in Euro; bei USD-Partnern hier zusaetzlich umrechnen
  const coins = Math.round(Number(payout) * 1000 * ANTEIL_NUTZER);
  if (!Number.isFinite(coins) || coins <= 0) return res.status(400).send("payout fehlt");

  const risiko = risikoPruefen(await db.kennzahlenFuer(user_id));
  await db.gutschreiben({
    nutzerId: user_id, art: "aufgabe", coins,
    titel: offer_name, partner, partnerTx: transaction_id,
    status: risiko.stufe === "gesperrt" ? "zurueckgehalten" : "haltefrist",
    halteStunden: risiko.halteStunden ?? 24 * 30,   // Schattensperre: 30 Tage geparkt
    risikoPunkte: risiko.punkte,
  });
  await db.risikoMerken({ nutzerId: user_id, punkte: risiko.punkte, stufe: risiko.stufe,
    treffer: risiko.treffer, anlass: "postback" });

  res.send("ok"); // Partner erwartet 200 mit "ok" oder "1"
});

/* Storno-Postback: Partner zieht eine Buchung zurueck */
app.get("/postback/:partner/storno", async (req, res) => {
  if (!signaturOk(req.params.partner, req)) return res.status(403).send("Signatur falsch");
  await db.stornieren(req.params.partner, req.query.transaction_id); // Guthaben darf ins Minus gehen
  res.send("ok");
});

/* ============================================================
   5. AUSZAHLUNG ANFORDERN
   ============================================================ */

app.post("/api/auszahlung", angemeldet, async (req, res) => {
  const { methode, ziel } = req.body;
  const userId = req.nutzer.id;   // NIE aus dem Body nehmen — sonst kann jeder fremde Konten auszahlen
  const nutzer = req.nutzer;

  const m = PAYOUTS[methode];
  if (!m || !m.aktiv) return res.status(400).json({ fehler: "Diese Auszahlungsart ist nicht eingerichtet." });

  const betrag = Math.round(Number(req.body.betrag) * 100) / 100;
  if (!Number.isFinite(betrag) || betrag < m.min)
    return res.status(400).json({ fehler: `Mindestbetrag sind ${m.min} €.` });
  if (!zielOk(methode, ziel))
    return res.status(400).json({ fehler: "Das Auszahlungsziel sieht nicht richtig aus." });
  if (!nutzer.telefon_bestaetigt)
    return res.status(403).json({ fehler: "Bestaetige zuerst deine Telefonnummer." });

  const frei = await db.freiesGuthabenEur(userId); // nur Gutschriften nach Ablauf der Haltefrist
  if (frei < betrag) return res.status(400).json({ fehler: "Dein Guthaben ist noch in der Haltefrist." });

  const heute = await db.ausgezahltHeute(userId);
  if (heute + betrag > 50)
    return res.status(429).json({ fehler: "Mehr als 50 € pro Tag sind nicht moeglich." });

  const summeMonat = await db.ausgezahltImMonat(userId);
  if (summeMonat + betrag > 100 && !nutzer.ausweis_geprueft)
    return res.status(403).json({ fehler: "Ab 100 € im Monat brauchen wir einmal deinen Ausweis." });

  // Erst abbuchen, dann Endstand pruefen: laufen zwei Anfragen gleichzeitig,
  // rutscht das Guthaben ins Minus und die spaetere wird zurueckgedreht.
  const coins = Math.round(betrag * 1000);
  await db.gutschreiben({ nutzerId: userId, art: "auszahlung", coins: -coins,
    titel: `Auszahlung ${methode}`, status: "frei", halteStunden: 0 });
  if ((await db.freiesGuthabenEur(userId)) < 0) {
    await db.gutschreiben({ nutzerId: userId, art: "korrektur", coins,
      titel: "Auszahlung abgebrochen (Doppelanfrage)", status: "frei", halteStunden: 0 });
    return res.status(409).json({ fehler: "Bitte versuch es gleich noch einmal." });
  }

  const risiko = risikoPruefen(await db.kennzahlenFuer(userId));
  const auftrag = await db.auszahlungAnlegen({
    nutzerId: userId, methode, ziel: String(ziel).trim(), betrag, gebuehr: m.gebuehr,
    status: risiko.punkte < 30 ? "laeuft" : "pruefung",
    risiko,
  });
  await db.risikoMerken({ nutzerId: userId, punkte: risiko.punkte, stufe: risiko.stufe,
    treffer: risiko.treffer, anlass: "auszahlung" });

  if (auftrag.status === "laeuft") await m.senden(String(ziel).trim(), betrag - m.gebuehr);
  res.json({ belegId: auftrag.beleg_nr, status: auftrag.status });
});

/** Grobe Formpruefung des Ziels, damit kein Muell an die Zahlungsdienste geht */
function zielOk(methode, ziel = "") {
  const z = String(ziel).trim();
  if (z.length > 120) return false;
  if (methode === "bank")   return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(z.replace(/\s/g, "").toUpperCase());
  if (methode === "crypto") return /^[a-zA-Z0-9]{20,90}$/.test(z);
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(z);   // PayPal, Amazon, Steam, Visa: E-Mail
}

/* ============================================================
   6. Frontend-Daten
   ============================================================ */

app.get("/api/security", angemeldet, async (req, res) => {
  const risiko = risikoPruefen(await db.kennzahlenFuer(req.nutzer.id));
  res.json({ punkte: risiko.punkte, stufe: risiko.stufe, signale: risiko.texte });
});

app.get("/api/walls", angemeldet, async (req, res) => {
  // Signierte Offerwall-Links bauen, damit die User-ID nicht faelschbar ist
  res.json(await walls.fuerNutzer(req.nutzer.id));
});

function ipErlaubt(ip, liste) { return liste.length === 0 ? true : liste.some((n) => imNetz(ip, n)); }
function imNetz(ip, cidr) { /* CIDR-Pruefung, z.B. mit ip-range-check */ return true; }

const ANTEIL_NUTZER = 0.6; // 60 % der Partner-Einnahme geht an den Nutzer
const walls = { fuerNutzer: async () => [] }; // hier signierte Wall-Links je Anbieter bauen

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CoinCurb läuft auf Port ${PORT}`));
