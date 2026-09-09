/**
 * CoinCurb Backend — Grundgeruest
 * Node 18+ / Express. Start: node server.js
 *
 * Alles was ein Geheimnis ist, steht in der .env — nie im Frontend.
 * Siehe README.md fuer die Liste aller Variablen.
 */

import "dotenv/config";      // .env laden, bevor db.js/auth.js die Secrets pruefen
import "express-async-errors"; // Fehler in async-Routen landen im Fehler-Handler statt die Anfrage haengen zu lassen
import express from "express";
import helmet from "helmet";
import cors from "cors";
import crypto from "crypto";
import ipRangeCheck from "ip-range-check";
import rateLimit from "express-rate-limit";
import { pathToFileURL } from "url";
import { db } from "./db.js";
import auth, { angemeldet } from "./auth.js";
import { paypal, tango } from "./auszahlung.js";

const app = express();
app.set("trust proxy", 1);   // hinter Railway/Render sonst falsche IPs bei Allowlist und Rate-Limit
app.disable("x-powered-by");
app.use(helmet());           // Security-Header (nosniff, frame-deny, HSTS, ...)

/* CORS: Browser-Aufrufe nur von der eigenen Web-App. Anfragen ohne Origin
   (Partner-Postbacks, native App, curl) haben kein CORS und bleiben erlaubt.
   Capacitor-Origins kommen mit Aufgabe 15 ueber CORS_ORIGINS dazu. */
const ORIGINS = [process.env.APP_URL, ...(process.env.CORS_ORIGINS || "").split(",")]
  .map((o) => (o || "").trim().replace(/\/$/, "")).filter(Boolean);
class FremdeOrigin extends Error { constructor() { super("fremde Origin"); this.status = 403; } }
app.use(cors({
  origin: (origin, cb) => (!origin || ORIGINS.includes(origin)) ? cb(null, true) : cb(new FremdeOrigin()),
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Platform", "X-Emulator", "X-Rooted"],
  maxAge: 600,
}));

app.use(express.json({ limit: "50kb" }));
app.use(auth);               // Login-Routen aus auth.js
const startBremse = rateLimit({ windowMs: 15 * 60000, limit: 300, standardHeaders: true });

/* ============================================================
   1. PARTNER — Postback-Zugangsdaten
   Jeder Offerwall-Anbieter schickt eine Server-zu-Server-Meldung,
   wenn ein Nutzer eine Aufgabe abgeschlossen hat.
   Secret + erlaubte IPs bekommst du im Dashboard des Anbieters.
   ============================================================ */

/* Allowlists kommen aus der .env (z.B. ADGATE_IPS=204.13.156.0/24,2a01:db8::/32),
   IPv4 und IPv6, einzelne Adressen oder CIDR. Leer = jede IP erlaubt. */
const ipListe = (env, standard = "") =>
  (env ?? standard).split(",").map((x) => x.trim()).filter(Boolean);

/* Alle sechs Partner melden ihren Payout in US-Dollar. Umrechnung in Euro ueber USD_EUR aus der .env,
   danach gilt wie ueberall: 1.000 Coins = 1,00 €. */
const USD_EUR = Number(process.env.USD_EUR || 0.9);

/* Je Partner: Signaturpruefung exakt nach Anbieter-Doku, Mapping der Anbieter-Parameter auf unsere Namen,
   erwartete Antwort. `url` ist die Postback-URL, die im Dashboard des Anbieters eingetragen wird
   (Platzhalter in der Schreibweise des Anbieters). Alle lesen ihre Werte aus dem Query-String. */
const PARTNER = {
  adgate: {
    // AdGate Media (heute Prodege Performance) — docs.prodegeads.com/postbacks/postback-information
    // Kein Hash. Schutz laut Doku: IP-Liste der AdGate-Server + eine URL, die nur AdGate kennt.
    // Wir haengen dafuer einen geheimen token an; {state} = approved | rejected | pending.
    secret: process.env.ADGATE_SECRET,
    name: "AdGate Media", typ: "Offerwall", appInstalls: true,
    wall: (u) => process.env.ADGATE_WALL_ID && `https://wall.adgaterewards.com/${process.env.ADGATE_WALL_ID}/${u}`,
    ips: ipListe(process.env.ADGATE_IPS,
      "52.42.57.125,54.186.70.83,52.39.181.185,54.190.14.75,52.11.36.128,54.191.9.88,3.21.111.51,3.135.140.42,3.133.245.65"),
    url: "/postback/adgate?token=<ADGATE_SECRET>&user_id={s1}&transaction_id={conversion_id}&payout={payout}&offer_name={offer_name}&state={state}",
    antwort: "ok",
    pruefen: (req, p) => sicherGleich(String(req.query.token || ""), p.secret),
    lesen: (q) => ({
      nutzerId: q.user_id, tx: q.transaction_id, payoutUsd: q.payout, titel: q.offer_name,
      storno: q.state === "rejected",
      abwarten: q.state === "pending",          // noch nicht freigegeben: nichts buchen, spaeter kommt "approved"
    }),
  },
  ayet: {
    // ayeT-Studios — docs.ayetstudios.com → Callbacks → "HMAC Security Hash"
    // Header X-Ayetstudios-Security-Hash = HMAC-SHA256(API-Key, alphabetisch sortierter Query-String, form-encoded).
    // Gilt fuer ALLE Parameter der URL; {is_chargeback}=1 bei Rueckbuchung, {payout_usd} in USD.
    secret: process.env.AYET_SECRET,           // = Publisher-API-Key aus den Account-Einstellungen
    name: "AyeT Studios", typ: "Offerwall", appInstalls: true,
    wall: (u) => process.env.AYET_PLACEMENT && `https://www.ayetstudios.com/offers/web_offerwall/${process.env.AYET_PLACEMENT}?external_identifier=${u}`,
    ips: ipListe(process.env.AYET_IPS),
    url: "/postback/ayet?user_id={external_identifier}&transaction_id={transaction_id}&payout={payout_usd}&offer_name={offer_name}&chargeback={is_chargeback}",
    antwort: "ok",
    pruefen: (req, p) => sicherGleich(signaturen.ayet(rohQuery(req), p.secret),
      String(req.headers["x-ayetstudios-security-hash"] || "")),
    lesen: (q) => ({ nutzerId: q.user_id, tx: q.transaction_id, payoutUsd: q.payout, titel: q.offer_name,
      storno: q.chargeback === "1" }),
  },
  torox: {
    // Torox (frueher OfferToro) — Postback-Doku im Publisher-Dashboard; Format wie OfferToro:
    // feste Parameter id, oid, user_id, amount, payout, o_name, sig mit sig = md5(oid-user_id-APP_KEY).
    // Der Hash deckt payout NICHT ab — deshalb hier unbedingt TOROX_IPS aus dem Dashboard setzen.
    // Rueckbuchungen kommen als negativer payout mit derselben id.
    secret: process.env.TOROX_SECRET,          // = Secret Key der App
    name: "Torox", typ: "Offerwall", appInstalls: true,
    wall: (u) => process.env.TOROX_OFFERWALL_ID && `https://torox.io/ifr/show/${process.env.TOROX_OFFERWALL_ID}/${u}`,
    ips: ipListe(process.env.TOROX_IPS),
    url: "/postback/torox   (Torox haengt seine Parameter selbst an)",
    antwort: "ok",
    pruefen: (req, p) => sicherGleich(signaturen.torox(req.query.oid, req.query.user_id, p.secret), String(req.query.sig || "")),
    lesen: (q) => ({ nutzerId: q.user_id, tx: q.id, payoutUsd: q.payout, titel: q.o_name,
      storno: Number(q.payout) < 0 }),
  },
  lootably: {
    // Lootably — documentation.lootably.com/docs/postbacks, github.com/lootably/lootably-postback-hash
    // {hash} = sha256(userID + ip + revenue + currencyReward + Postback-Secret), ohne Trennzeichen.
    // {status}: 1 = Abschluss, 0 = Rueckbuchung. Antwort muss der Body "1" sein.
    secret: process.env.LOOTABLY_SECRET,       // = Postback Secret des Placements
    name: "Lootably", typ: "Offerwall", appInstalls: true,
    wall: (u) => process.env.LOOTABLY_PLACEMENT && `https://wall.lootably.com/?placementID=${process.env.LOOTABLY_PLACEMENT}&userID=${u}`,
    ips: ipListe(process.env.LOOTABLY_IPS),
    url: "/postback/lootably?user_id={userID}&transaction_id={transactionID}&ip={ip}&payout={revenue}&reward={currencyReward}&offer_name={offerName}&status={status}&signature={hash}",
    antwort: "1",
    pruefen: (req, p) => sicherGleich(signaturen.lootably(req.query, p.secret), String(req.query.signature || "")),
    lesen: (q) => ({ nutzerId: q.user_id, tx: q.transaction_id, payoutUsd: q.payout, titel: q.offer_name,
      storno: q.status === "0" }),
  },
  bitlabs: {
    // BitLabs — developer.bitlabs.ai/docs/securing-callbacks-through-hashing
    // &hash = HMAC-SHA1(App-Secret, komplette Callback-URL inkl. Schema+Host bis vor "&hash=").
    // [%ACTIVITY:TYPE%] = COMPLETE | SCREENOUT | START_BONUS | RECONCILIATION; bei RECONCILIATION
    // verweist [%REF%] auf die urspruengliche Transaktion (Werte koennen negativ sein).
    secret: process.env.BITLABS_SECRET,        // = App Secret
    name: "BitLabs", typ: "Umfragen", appInstalls: false,
    wall: (u) => process.env.BITLABS_TOKEN && `https://web.bitlabs.ai/?token=${process.env.BITLABS_TOKEN}&uid=${u}`,
    ips: ipListe(process.env.BITLABS_IPS, "20.76.54.40/29,18.199.243.90,18.157.62.114,18.193.24.206"),
    url: "/postback/bitlabs?user_id=[%USER:UID%]&transaction_id=[%TX%]&payout=[%VALUE:USD%]&type=[%ACTIVITY:TYPE%]&ref=[%REF%]&offer_name=[%OFFER:NAME%]",
    antwort: "ok",
    pruefen: (req, p) => sicherGleich(signaturen.bitlabs(volleUrl(req), p.secret), String(req.query.hash || "")),
    lesen: (q) => ({ nutzerId: q.user_id, tx: q.transaction_id, payoutUsd: q.payout, titel: q.offer_name,
      storno: q.type === "RECONCILIATION" || Number(q.payout) < 0,
      stornoTx: q.ref || q.transaction_id }),
  },
  cpx: {
    // CPX Research — Postback-Einstellungen im Publisher-Dashboard
    // {secure_hash} = md5({trans_id}-App-Secure-Hash); {status}: 1 = abgeschlossen, 2 = storniert; {amount_usd} in USD.
    // Der Hash deckt user_id und Betrag NICHT ab — CPX_IPS aus dem Dashboard setzen.
    secret: process.env.CPX_SECRET,            // = Secure Hash der App
    name: "CPX Research", typ: "Umfragen", appInstalls: false,
    // Der Wall-Link ist signiert: secure_hash = md5(user_id-AppSecureHash) — sonst laesst sich die Nutzer-ID faelschen
    wall: (u) => process.env.CPX_APP_ID && process.env.CPX_SECRET &&
      `https://offers.cpx-research.com/index.php?app_id=${process.env.CPX_APP_ID}&ext_user_id=${u}&secure_hash=${md5(`${u}-${process.env.CPX_SECRET}`)}`,
    ips: ipListe(process.env.CPX_IPS),
    url: "/postback/cpx?user_id={user_id}&transaction_id={trans_id}&payout={amount_usd}&status={status}&signature={secure_hash}",
    antwort: "ok",
    pruefen: (req, p) => sicherGleich(signaturen.cpx(req.query.transaction_id, p.secret), String(req.query.signature || "")),
    lesen: (q) => ({ nutzerId: q.user_id, tx: q.transaction_id, payoutUsd: q.payout, titel: q.offer_name || "Umfrage",
      storno: q.status === "2" }),
  },
};

/** Die reinen Signaturformeln — je eine pro Anbieter, testbar ohne HTTP. */
export const signaturen = {
  /** HMAC-SHA256 ueber die alphabetisch sortierten Parameter, form-encoded (Leerzeichen = "+"). */
  ayet: (query, apiKey) => {
    const paare = [...new URLSearchParams(query)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return crypto.createHmac("sha256", apiKey).update(new URLSearchParams(paare).toString()).digest("hex");
  },
  torox: (oid, userId, key) => md5(`${oid}-${userId}-${key}`),
  lootably: (q, secret) => sha256(`${q.user_id ?? ""}${q.ip ?? ""}${q.payout ?? ""}${q.reward ?? ""}${secret}`),
  /** HMAC-SHA1 ueber die komplette URL bis vor "&hash=" — unveraendert, nicht neu kodieren. */
  bitlabs: (url, secret) => crypto.createHmac("sha1", secret).update(url.split("&hash=")[0]).digest("hex"),
  cpx: (transId, secureHash) => md5(`${transId}-${secureHash}`),
};
const md5 = (t) => crypto.createHash("md5").update(String(t)).digest("hex");
const sha256 = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

/** Query-String so, wie er ankam (ohne fuehrendes "?") */
const rohQuery = (req) => req.originalUrl.split("?").slice(1).join("?");
/** Oeffentliche URL dieses Aufrufs — hinter einem Proxy aus POSTBACK_BASIS (z.B. https://api.deine-domain.de) */
const volleUrl = (req) => (process.env.POSTBACK_BASIS || `${req.protocol}://${req.get("host")}`) + req.originalUrl;

/* ============================================================
   2. AUSZAHLUNGEN
   ============================================================ */

/* Freigeschaltete Auszahlungswege stehen in der .env: AUSZAHLUNG_AKTIV=amazon,paypal */
const AKTIV = ipListe(process.env.AUSZAHLUNG_AKTIV);

/* senden(auftrag, ziel) → { status, ref, grund }; status(auftrag) fuer asynchrone Dienste.
   Das Ziel wird erst unmittelbar vor dem Senden entschluesselt (db.auszahlungZiel). */
const nichtEingerichtet = async () => { throw new Error("Auszahlungsweg nicht eingerichtet"); };
const PAYOUTS = {
  paypal: { aktiv: AKTIV.includes("paypal"), min: 5.0, gebuehr: 0,
            senden: (a, ziel) => paypal.senden(a, ziel), status: (a) => paypal.status(a) },
  amazon: { aktiv: AKTIV.includes("amazon"), min: 5.0, gebuehr: 0,
            senden: (a, ziel) => tango.senden(a, ziel, process.env.TANGO_UTID_AMAZON) },
  steam:  { aktiv: AKTIV.includes("steam"),  min: 5.0, gebuehr: 0,
            senden: (a, ziel) => tango.senden(a, ziel, process.env.TANGO_UTID_STEAM) },
  bank:   { aktiv: AKTIV.includes("bank"),   min: 20.0, gebuehr: 0.35, senden: nichtEingerichtet },   // Wise / Stripe Connect
  crypto: { aktiv: AKTIV.includes("crypto"), min: 10.0, gebuehr: 0.5,  senden: nichtEingerichtet },   // Coinbase Commerce
};

/** Auftrag beim Dienst ausfuehren; bei Fehler oder Ablehnung Guthaben zurueckbuchen. Liefert den Endstatus. */
export async function auszahlungAusfuehren(auftrag) {
  const m = PAYOUTS[auftrag.methode];
  let ergebnis;
  try {
    const ziel = await db.auszahlungZiel(auftrag.id);        // Klartext nur hier, nur jetzt
    ergebnis = await m.senden(auftrag, ziel);
  } catch (e) {
    await db.protokoll(auftrag.nutzer_id, "auszahlung_fehler",
      { beleg: auftrag.beleg_nr, methode: auftrag.methode, fehler: String(e.message || e).replace(/\S+@\S+/g, "[mail]").slice(0, 200) });
    ergebnis = { status: "abgelehnt", grund: "dienst" };
  }
  return auszahlungAbschliessen(auftrag, ergebnis);
}

async function auszahlungAbschliessen(auftrag, { status, ref = null, grund = null }) {
  const a = await db.auszahlungAbschliessen({ id: auftrag.id, status, anbieterRef: ref });
  if (!a) return auftrag.status;                              // war schon erledigt — nichts doppelt buchen
  if (status === "abgelehnt") {
    await db.gutschreiben({ nutzerId: a.nutzer_id, art: "korrektur", coins: Math.round(Number(a.betrag_eur) * 1000),
      titel: "Auszahlung fehlgeschlagen – Guthaben zurück", status: "frei", halteStunden: 0 });
    await db.protokoll(a.nutzer_id, "auszahlung_abgelehnt", { beleg: a.beleg_nr, methode: a.methode, grund, ref });
  } else if (status === "ausgezahlt") {
    await db.protokoll(a.nutzer_id, "auszahlung_ausgezahlt", { beleg: a.beleg_nr, methode: a.methode, ref });
  }
  return status;
}

/** Laufende Auftraege beim Dienst nachschauen (PayPal-Batches sind asynchron). Alle 5 Minuten, siehe unten. */
export async function auszahlungenNachpruefen() {
  for (const a of await db.auszahlungenOffen()) {
    const m = PAYOUTS[a.methode];
    if (!m?.status) continue;
    try {
      const e = await m.status(a);
      if (e.status !== "laeuft") await auszahlungAbschliessen(a, e);
    } catch (e) {
      await db.protokoll(a.nutzer_id, "auszahlung_nachpruefung_fehler",
        { beleg: a.beleg_nr, fehler: String(e.message || e).replace(/\S+@\S+/g, "[mail]").slice(0, 200) });
    }
  }
}

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
  try { return p.pruefen(req, p) === true; } catch { return false; }
}

function sicherGleich(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/* Reihenfolge fest: Partner bekannt → IP → Signatur → Parameter lesen → buchen.
   Antwort an den Partner ist bei Duplikaten und unbekannter Nutzer-ID trotzdem 200 (sonst wiederholt er). */
app.get("/postback/:partner", (req, res) => postbackAnnehmen(req, res, false));
/* Eigene Storno-URL fuer Partner, die Rueckbuchungen an eine zweite Adresse schicken koennen */
app.get("/postback/:partner/storno", (req, res) => postbackAnnehmen(req, res, true));

async function postbackAnnehmen(req, res, stornoErzwingen) {
  const { partner } = req.params;
  const p = PARTNER[partner];
  if (!p) return res.status(404).send("unbekannter Partner");
  if (!ipErlaubt(req.ip, p.ips)) return res.status(403).send("IP nicht erlaubt");
  if (!signaturOk(partner, req)) return res.status(403).send("Signatur falsch");

  const m = p.lesen(req.query);
  if (!m.tx) return res.status(400).send("transaction_id fehlt");

  if (stornoErzwingen || m.storno) {
    await db.stornieren(partner, m.stornoTx || m.tx);   // Guthaben darf ins Minus gehen
    return res.send(p.antwort);
  }
  if (m.abwarten) return res.send(p.antwort);

  // Doppelte Meldungen abweisen (partner + transaction_id unique in der DB)
  if (await db.transaktionExistiert(partner, m.tx)) return res.send(p.antwort);
  // unbekannte oder kaputte ID: nichts gutschreiben, aber Partner-Wiederholung stoppen
  if (!UUID.test(String(m.nutzerId || "")) || !(await db.nutzer(m.nutzerId))) return res.send(p.antwort);

  const eur = Number(m.payoutUsd) * USD_EUR;
  const coins = Math.round(eur * 1000 * ANTEIL_NUTZER);
  if (!Number.isFinite(coins) || coins <= 0) return res.status(400).send("payout fehlt");

  const risiko = risikoPruefen(await db.kennzahlenFuer(m.nutzerId));
  await db.gutschreiben({
    nutzerId: m.nutzerId, art: "aufgabe", coins,
    titel: m.titel, partner, partnerTx: m.tx,
    status: risiko.stufe === "gesperrt" ? "zurueckgehalten" : "haltefrist",
    halteStunden: risiko.halteStunden ?? 24 * 30,   // Schattensperre: 30 Tage geparkt
    risikoPunkte: risiko.punkte,
  });
  await db.risikoMerken({ nutzerId: m.nutzerId, punkte: risiko.punkte, stufe: risiko.stufe,
    treffer: risiko.treffer, anlass: "postback" });

  res.send(p.antwort);
}

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
  // Innerhalb eines Prozesses laufen Anfragen desselben Nutzers dafuer nacheinander,
  // damit genau eine durchkommt; ueber mehrere Instanzen hinweg schuetzt die Endstand-Pruefung.
  const coins = Math.round(betrag * 1000);
  const gedeckt = await nacheinander(userId, async () => {
    await db.gutschreiben({ nutzerId: userId, art: "auszahlung", coins: -coins,
      titel: `Auszahlung ${methode}`, status: "frei", halteStunden: 0 });
    if ((await db.freiesGuthabenEur(userId)) >= 0) return true;
    await db.gutschreiben({ nutzerId: userId, art: "korrektur", coins,
      titel: "Auszahlung abgebrochen (Doppelanfrage)", status: "frei", halteStunden: 0 });
    return false;
  });
  if (!gedeckt) return res.status(409).json({ fehler: "Bitte versuch es gleich noch einmal." });

  const risiko = risikoPruefen(await db.kennzahlenFuer(userId, { ziel: String(ziel).trim() }));
  const auftrag = await db.auszahlungAnlegen({
    nutzerId: userId, methode, ziel: String(ziel).trim(), betrag, gebuehr: m.gebuehr,
    status: risiko.punkte < 30 ? "laeuft" : "pruefung",
    risiko,
  });
  await db.risikoMerken({ nutzerId: userId, punkte: risiko.punkte, stufe: risiko.stufe,
    treffer: risiko.treffer, anlass: "auszahlung" });

  let status = auftrag.status, hinweis;
  if (status === "laeuft") status = await auszahlungAusfuehren(auftrag);
  if (status === "abgelehnt")
    hinweis = "Die Auszahlung hat nicht geklappt. Dein Guthaben ist wieder da – prüf bitte dein Ziel und versuch es später noch einmal.";
  else if (status === "pruefung")
    hinweis = "Wir schauen uns diese Auszahlung kurz von Hand an. Du bekommst Bescheid.";
  res.json({ belegId: auftrag.beleg_nr, status, hinweis });
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

/* Aufgabenstart vom Client — Grundlage fuer Dauer, Taktung und Pausen in der Betrugserkennung */
app.post("/api/aufgabe/start", angemeldet, startBremse, async (req, res) => {
  const partner = String(req.body.partner || "");
  if (!PARTNER[partner]) return res.status(400).json({ fehler: "Diesen Anbieter kennen wir nicht." });
  const angebot = req.body.angebot == null ? null : String(req.body.angebot).slice(0, 120);
  const dauer = Number(req.body.erwarteteDauerSek);
  await db.aufgabeGestartet({
    nutzerId: req.nutzer.id, partner, angebot,
    erwarteteDauerSek: Number.isFinite(dauer) && dauer > 0 ? Math.min(Math.round(dauer), 86400) : null,
  });
  res.json({ ok: true });
});

app.get("/api/walls", angemeldet, async (req, res) => {
  // Signierte Offerwall-Links bauen, damit die User-ID nicht faelschbar ist
  res.json(await walls.fuerNutzer(req.nutzer.id));
});

/* Freigeschaltete Auszahlungswege fuer die App */
app.get("/api/auszahlung/wege", angemeldet, (req, res) => {
  res.json(Object.entries(PAYOUTS).filter(([, m]) => m.aktiv).map(([id, m]) => ({ id, min: m.min, gebuehr: m.gebuehr })));
});

/* Verlauf: letzte Buchungen und Auszahlungen des Nutzers */
app.get("/api/verlauf", angemeldet, async (req, res) => {
  res.json(await db.verlauf(req.nutzer.id));
});

/** Leere Liste = alles erlaubt. Sonst muss die IP (v4 oder v6, auch ::ffff:-gemappt) in einem Eintrag liegen. */
export function ipErlaubt(ip, liste) {
  if (liste.length === 0) return true;
  if (!ip) return false;
  return liste.some((n) => imNetz(ip, n));
}
function imNetz(ip, cidr) { try { return ipRangeCheck(ip, cidr); } catch { return false; } }

/** Reiht Arbeit pro Schluessel hintereinander (in diesem Prozess). */
const warteschlangen = new Map();
function nacheinander(schluessel, arbeit) {
  const vorher = warteschlangen.get(schluessel) || Promise.resolve();
  const jetzt = vorher.catch(() => {}).then(arbeit);
  warteschlangen.set(schluessel, jetzt);
  jetzt.finally(() => { if (warteschlangen.get(schluessel) === jetzt) warteschlangen.delete(schluessel); });
  return jetzt;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANTEIL_NUTZER = 0.6; // 60 % der Partner-Einnahme geht an den Nutzer
/* Angebotswaende fuer einen Nutzer: nur Partner mit eingetragener oeffentlicher ID, Links mit dessen Nutzer-ID */
const walls = {
  fuerNutzer: async (nutzerId) =>
    Object.entries(PARTNER)
      .map(([id, p]) => ({ id, name: p.name, typ: p.typ, appInstalls: p.appInstalls, url: p.wall(encodeURIComponent(nutzerId)) || null }))
      .filter((w) => w.url),
};

/* ============================================================
   7. Fehler — nie Technik-Details nach aussen
   ============================================================ */

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof FremdeOrigin)      return res.status(403).json({ fehler: "Dieser Aufruf ist von hier aus nicht erlaubt." });
  if (err.type === "entity.too.large")  return res.status(413).json({ fehler: "Die Anfrage ist zu gross." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ fehler: "Die Anfrage konnte nicht gelesen werden." });
  console.error(err);                   // intern vollstaendig, nach aussen nur eine allgemeine Meldung
  res.status(err.status || 500).json({ fehler: "Da ist etwas schiefgelaufen. Bitte versuch es spaeter noch einmal." });
});

export default app;

/* Nur starten, wenn die Datei direkt aufgerufen wird (Tests importieren nur die App) */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`CoinCurb läuft auf Port ${PORT}`));
  setInterval(() => auszahlungenNachpruefen().catch(() => {}), 5 * 60000).unref();
}
