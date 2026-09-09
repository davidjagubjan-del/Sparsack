/**
 * CoinCurb — Login
 * Einbinden in server.js:  import auth from "./auth.js"; app.use(auth);
 *
 * npm i express argon2 jsonwebtoken pg zod express-rate-limit
 */

import express from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db, hash } from "./db.js";
import { mail, sms } from "./versand.js";

const auth = express.Router();
const GEHEIM = process.env.JWT_SECRET;              // in .env, mind. 32 Zeichen
if (!GEHEIM || GEHEIM.length < 32)
  throw new Error("JWT_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen).");
const ZUGANG_MIN = 15;                              // Access-Token 15 Minuten
const REFRESH_TAGE = 60;

const bremse = (anzahl, minuten) =>
  rateLimit({ windowMs: minuten * 60000, limit: anzahl, standardHeaders: true });

/* ---------- Hilfen ---------- */

function tokenBauen(nutzerId) {
  return jwt.sign({ sub: nutzerId }, GEHEIM, { expiresIn: ZUGANG_MIN + "m" });
}

async function refreshBauen(nutzerId, geraetId, ip) {
  const roh = crypto.randomBytes(48).toString("base64url");
  await db.sitzungAnlegen({
    nutzerId, geraetId, ipHash: hash(ip), refreshHash: hash(roh),
    laeuftAb: new Date(Date.now() + REFRESH_TAGE * 864e5),
  });
  return roh;
}

/** Vor jeder geschützten Route */
export async function angemeldet(req, res, next) {
  const kopf = req.headers.authorization || "";
  try {
    const { sub } = jwt.verify(kopf.replace("Bearer ", ""), GEHEIM);
    const n = await db.nutzer(sub);
    if (!n || n.geloescht_am) return res.status(401).json({ fehler: "Bitte melde dich neu an." });
    if (n.gesperrt) return res.status(403).json({ fehler: "Dieses Konto ist gesperrt.", grund: n.sperrgrund });
    req.nutzer = n;
    next();
  } catch {
    res.status(401).json({ fehler: "Bitte melde dich neu an." });
  }
}

/** Gerät bei jedem Aufruf mitschreiben — Basis der Betrugserkennung */
async function geraetErfassen(req, nutzerId) {
  const fp = req.headers["x-device-id"];           // FingerprintJS o.ä. aus der App
  if (!fp) return null;
  const g = await db.geraetMerken({
    fingerprint: fp,
    plattform: req.headers["x-platform"],
    emulator: req.headers["x-emulator"] === "1",
    rootJailbreak: req.headers["x-rooted"] === "1",
  });
  const netz = await netzTyp(req.ip);
  await db.geraetVerknuepfen({
    nutzerId, geraetId: g.id, ipHash: hash(req.ip),
    ipTyp: netz.typ, ipLand: req.headers["cf-ipcountry"] || netz.land || null,
  });
  return g;
}

/* ---------- Proxy-/VPN-Erkennung ueber IPQualityScore ----------
   Ergebnis wird 24 h je IP-Hash gecacht (Tabelle ip_netz). Ohne Key, bei privaten
   Adressen, Timeout oder Fehler des Dienstes: 'unbekannt' — nie blockieren, nie werfen. */

const PRIVAT = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:|::ffff:(127\.|10\.|192\.168\.))/i;

export async function netzTyp(ip) {
  const unbekannt = { typ: "unbekannt", land: null };
  if (!ip || PRIVAT.test(ip) || !process.env.IPQS_KEY) return unbekannt;
  try {
    const c = await db.netzAusCache(ip);
    if (c) return c;
  } catch { /* Cache-Fehler ist kein Grund zum Blockieren */ }

  let ergebnis = unbekannt;
  try {
    const url = `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(process.env.IPQS_KEY)}/${encodeURIComponent(ip)}`
      + "?strictness=0&allow_public_access_points=true";
    const r = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.IPQS_TIMEOUT_MS || 3000)) });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success === true) ergebnis = { typ: netzTypAus(d), land: d.country_code || null };
    }
  } catch { /* Timeout, Netzfehler, kaputtes JSON → unbekannt */ }

  if (ergebnis.typ !== "unbekannt") db.netzMerken(ip, ergebnis.typ, ergebnis.land).catch(() => {});
  return ergebnis;
}

/** IPQS-Antwort → unsere vier Netztypen */
export function netzTypAus(d) {
  const art = String(d.connection_type || "").toLowerCase();
  if (d.tor || d.active_tor || d.vpn || d.active_vpn) return "vpn";
  if (d.proxy || art === "data center") return "rechenzentrum";
  if (d.mobile === true || art === "mobile") return "mobil";
  if (["residential", "corporate", "education"].includes(art)) return "kabel";
  return "unbekannt";
}

/* ---------- Registrieren ---------- */

auth.post("/api/registrieren", bremse(5, 60), async (req, res) => {
  const { email, passwort, anzeigename, werbecode } = req.body;

  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email || ""))
    return res.status(400).json({ fehler: "Diese E-Mail-Adresse stimmt nicht." });
  if ((passwort || "").length < 10)
    return res.status(400).json({ fehler: "Das Passwort braucht mindestens 10 Zeichen." });
  if (await db.emailVergeben(email))
    return res.status(409).json({ fehler: "Für diese E-Mail gibt es schon ein Konto." });
  if (await db.aufSperrliste("email", email.toLowerCase()))
    return res.status(403).json({ fehler: "Mit dieser Adresse ist keine Anmeldung möglich." });

  const nutzer = await db.nutzerAnlegen({
    email: email.toLowerCase(),
    passwortHash: await argon2.hash(passwort, { type: argon2.argon2id }),
    anzeigename: (anzeigename || email.split("@")[0]).slice(0, 24),
    geworbenVon: werbecode ? await db.nutzerZuCode(werbecode) : null,
  });

  const geraet = await geraetErfassen(req, nutzer.id);
  if (geraet?.gesperrt) {
    await db.nutzerSperren(nutzer.id, "Gerät ist gesperrt");
    return res.status(403).json({ fehler: "Auf diesem Gerät ist keine Anmeldung möglich." });
  }

  await mailCodeSenden(nutzer);            // Fehler landen im Protokoll, Nutzer kann neu anfordern
  res.json({
    zugang: tokenBauen(nutzer.id),
    refresh: await refreshBauen(nutzer.id, geraet?.id, req.ip),
    naechsterSchritt: "email_bestaetigen",
  });
});

/* ---------- Anmelden ---------- */

auth.post("/api/anmelden", bremse(10, 15), async (req, res) => {
  const { email, passwort } = req.body;
  const nutzer = await db.nutzerNachEmail((email || "").toLowerCase());

  // Gleiche Antwort und gleiche Laufzeit, egal ob es das Konto gibt
  const ok = nutzer?.passwort_hash ? await argon2.verify(nutzer.passwort_hash, passwort || "") : false;
  if (!ok) return res.status(401).json({ fehler: "E-Mail oder Passwort stimmt nicht." });
  if (nutzer.gesperrt) return res.status(403).json({ fehler: "Dieses Konto ist gesperrt.", grund: nutzer.sperrgrund });
  if (nutzer.geloescht_am) return res.status(401).json({ fehler: "E-Mail oder Passwort stimmt nicht." });

  const geraet = await geraetErfassen(req, nutzer.id);
  await db.aktivGesehen(nutzer.id);

  res.json({
    zugang: tokenBauen(nutzer.id),
    refresh: await refreshBauen(nutzer.id, geraet?.id, req.ip),
    naechsterSchritt: !nutzer.email_bestaetigt ? "email_bestaetigen"
      : !nutzer.telefon_bestaetigt ? "telefon_bestaetigen" : null,
  });
});

/* Apple-Login ist im App Store Pflicht, sobald es andere Fremd-Logins gibt */
auth.post("/api/anmelden/apple", bremse(20, 15), async (req, res) => {
  const sub = await appleTokenPruefen(req.body.identityToken);   // Apple-Public-Keys prüfen
  if (!sub) return res.status(401).json({ fehler: "Die Anmeldung bei Apple hat nicht geklappt." });
  const nutzer = await db.nutzerNachApple(sub, req.body.email);
  const geraet = await geraetErfassen(req, nutzer.id);
  res.json({ zugang: tokenBauen(nutzer.id), refresh: await refreshBauen(nutzer.id, geraet?.id, req.ip) });
});

async function appleTokenPruefen(token) { /* jose + https://appleid.apple.com/auth/keys */ return null; }

/* ---------- Token erneuern / abmelden ---------- */

auth.post("/api/token", bremse(60, 15), async (req, res) => {
  const s = await db.sitzungNachHash(hash(req.body.refresh || ""));
  if (!s) return res.status(401).json({ fehler: "Bitte melde dich neu an." });
  if (s.widerrufen) {
    // Ein bereits ausgetauschtes Token taucht wieder auf — sehr wahrscheinlich gestohlen.
    await db.sitzungenWiderrufen(s.nutzer_id);
    await db.protokoll(s.nutzer_id, "refresh_wiederverwendet", { sitzung: s.id });
    return res.status(401).json({ fehler: "Bitte melde dich neu an." });
  }
  if (new Date(s.laeuft_ab) < new Date())
    return res.status(401).json({ fehler: "Bitte melde dich neu an." });
  await db.sitzungWiderrufen(s.id);                       // Rotation: altes Token verfällt sofort
  res.json({ zugang: tokenBauen(s.nutzer_id), refresh: await refreshBauen(s.nutzer_id, s.geraet_id, req.ip) });
});

auth.post("/api/abmelden", angemeldet, async (req, res) => {
  await db.sitzungenWiderrufen(req.nutzer.id);
  res.json({ ok: true });
});

/* ---------- E-Mail bestätigen ---------- */

async function mailCodeSenden(nutzer) {
  const code = crypto.randomBytes(24).toString("base64url");
  await db.codeAnlegen({ nutzerId: nutzer.id, zweck: "email", codeHash: hash(code), minuten: 60 });
  try {
    return await mail.senden(nutzer.email, "Bestätige deine E-Mail bei CoinCurb",
      `Hallo ${nutzer.anzeigename},\n\ntippe hier, um dein Konto freizuschalten (60 Minuten gültig):\n`
      + `${process.env.APP_URL}/bestaetigen?c=${code}\n\nWarst du das nicht? Dann ignoriere diese Mail einfach.`);
  } catch (e) {
    await db.protokoll(nutzer.id, "mail_fehler", { zweck: "email", fehler: String(e.message || e).slice(0, 160) });
    return false;
  }
}

/* Bestätigungsmail noch einmal anfordern */
auth.post("/api/email/erneut", angemeldet, bremse(3, 60), async (req, res) => {
  if (req.nutzer.email_bestaetigt) return res.status(400).json({ fehler: "Deine E-Mail ist schon bestätigt." });
  const ok = await mailCodeSenden(req.nutzer);
  if (!ok) return res.status(502).json({ fehler: "Die Mail konnte gerade nicht verschickt werden. Versuch es in ein paar Minuten noch einmal." });
  res.json({ ok: true });
});

auth.get("/api/email/bestaetigen", bremse(20, 60), async (req, res) => {
  const treffer = await db.codeEinloesen({ zweck: "email", codeHash: hash(req.query.c || "") });
  if (!treffer) return res.status(400).json({ fehler: "Dieser Link ist abgelaufen. Fordere einen neuen an." });
  await db.emailBestaetigt(treffer.nutzer_id);
  await db.gutschreiben({ nutzerId: treffer.nutzer_id, art: "bonus", coins: 500, titel: "Willkommensbonus" });
  res.json({ ok: true });
});

/* ---------- Telefon bestätigen (vor der ersten Auszahlung) ----------
   Twilio Verify erzeugt und prueft den Code; wir speichern nur den Hash der bestaetigten Nummer. */

const E164 = /^\+[1-9]\d{6,14}$/;
const nummerAus = (roh) => String(roh || "").replace(/[\s\-()]/g, "").replace(/^00/, "+");

auth.post("/api/telefon/code", angemeldet, bremse(5, 60), async (req, res) => {
  const nummer = nummerAus(req.body.telefon);
  if (!E164.test(nummer))
    return res.status(400).json({ fehler: "Bitte gib deine Nummer mit Ländervorwahl an, zum Beispiel +49 170 1234567." });
  if (await db.telefonVergeben(nummer, req.nutzer.id))
    return res.status(409).json({ fehler: "Diese Nummer gehört bereits zu einem anderen Konto." });
  if (!sms.eingerichtet())
    return res.status(503).json({ fehler: "Der SMS-Versand ist gerade nicht möglich. Bitte versuch es später noch einmal." });
  try {
    await sms.codeSenden(nummer);
  } catch (e) {
    await db.protokoll(req.nutzer.id, "sms_fehler", { fehler: String(e.message || e).slice(0, 160) });
    return res.status(502).json({ fehler: "Die SMS konnte nicht verschickt werden. Prüf die Nummer und versuch es gleich noch einmal." });
  }
  res.json({ ok: true });
});

auth.post("/api/telefon/pruefen", angemeldet, bremse(10, 60), async (req, res) => {
  const nummer = nummerAus(req.body.telefon);
  const code = String(req.body.code || "").trim();
  if (!E164.test(nummer) || !/^\d{4,10}$/.test(code))
    return res.status(400).json({ fehler: "Der Code stimmt nicht oder ist abgelaufen." });
  if (await db.telefonVergeben(nummer, req.nutzer.id))
    return res.status(409).json({ fehler: "Diese Nummer gehört bereits zu einem anderen Konto." });
  if (!sms.eingerichtet())
    return res.status(503).json({ fehler: "Die Prüfung ist gerade nicht möglich. Bitte versuch es später noch einmal." });
  let ok = false;
  try { ok = await sms.codePruefen(nummer, code); }
  catch (e) {
    await db.protokoll(req.nutzer.id, "sms_fehler", { fehler: String(e.message || e).slice(0, 160) });
    return res.status(502).json({ fehler: "Die Prüfung hat gerade nicht geklappt. Versuch es gleich noch einmal." });
  }
  if (!ok) return res.status(400).json({ fehler: "Der Code stimmt nicht oder ist abgelaufen." });
  await db.telefonBestaetigt(req.nutzer.id, nummer);
  res.json({ ok: true });
});

/* ---------- Ich ---------- */

auth.get("/api/ich", angemeldet, async (req, res) => {
  const g = await db.guthaben(req.nutzer.id);
  res.json({
    name: req.nutzer.anzeigename,
    coins: g.coins_gesamt || 0,
    coinsFrei: g.coins_frei || 0,
    werbecode: db.codeFuer(req.nutzer.id),
    verifiziert: {
      mail: req.nutzer.email_bestaetigt,
      telefon: req.nutzer.telefon_bestaetigt,
      ausweis: req.nutzer.ausweis_geprueft,
    },
  });
});

/* ---------- Konto löschen (Pflicht für den App Store) ---------- */

auth.post("/api/konto/loeschen", angemeldet, async (req, res) => {
  await db.kontoLoeschen(req.nutzer.id);   // anonymisieren, Buchungen 10 Jahre aufbewahren (GoBD)
  await db.sitzungenWiderrufen(req.nutzer.id);
  res.json({ ok: true, hinweis: "Dein Konto ist gelöscht. Offenes Guthaben verfällt." });
});

export default auth;
