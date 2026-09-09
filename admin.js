/**
 * CoinCurb — Admin-Bereich (minimal)
 * Eigenes Passwort aus der .env (ADMIN_PASSWORT, HTTP Basic, Nutzername "admin").
 * Offene Auszahlungen mit Risiko-Treffern freigeben oder ablehnen, Konten sperren/entsperren,
 * Sperrlisten-Eintraege. Jede Aktion steht im protokoll mit wer = "admin".
 *
 * Formulare (HTML) und JSON (Content-Type: application/json) werden beide bedient.
 * POSTs von fremden Origins werden abgewiesen (Sec-Fetch-Site / Origin), weil der Browser
 * Basic-Auth-Zugangsdaten sonst auch bei Formularen von Fremdseiten mitschicken wuerde.
 */

import express from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db } from "./db.js";

const h = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (b) => Number(b).toFixed(2).replace(".", ",") + " €";
const wann = (d) => (d ? new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "–");

export default function adminRouter({ auszahlungAusfuehren, auszahlungAbschliessen }) {
  const r = express.Router();
  r.use(rateLimit({ windowMs: 15 * 60000, limit: 60, standardHeaders: true }));
  r.use(express.urlencoded({ extended: false, limit: "10kb" }));

  /* ---- Zugang ---- */
  r.use((req, res, next) => {
    const soll = process.env.ADMIN_PASSWORT || "";
    if (soll.length < 16) return res.status(503).send("Admin-Bereich ist nicht eingerichtet (ADMIN_PASSWORT, mindestens 16 Zeichen).");
    const kopf = req.headers.authorization || "";
    let ok = false;
    if (kopf.startsWith("Basic ")) {
      const [nutzer, ...rest] = Buffer.from(kopf.slice(6), "base64").toString().split(":");
      const pw = rest.join(":");
      const A = Buffer.from(pw), B = Buffer.from(soll);
      ok = nutzer === "admin" && A.length === B.length && crypto.timingSafeEqual(A, B);
    }
    if (!ok) {
      res.set("WWW-Authenticate", 'Basic realm="CoinCurb Admin", charset="UTF-8"');
      return res.status(401).send("Anmeldung erforderlich.");
    }
    if (req.method === "POST") {
      const site = req.headers["sec-fetch-site"];
      const origin = req.headers.origin;
      const eigene = `${req.protocol}://${req.get("host")}`;
      if ((site && !["same-origin", "none"].includes(site)) || (origin && origin !== eigene))
        return res.status(403).send("Aufruf von fremder Seite abgewiesen.");
    }
    next();
  });

  const jsonGewuenscht = (req) => req.is("json") || (req.get("accept") || "").includes("application/json");
  const antwort = (req, res, meldung, daten = {}) =>
    jsonGewuenscht(req) ? res.json({ ok: true, meldung, ...daten }) : res.redirect("/admin?meldung=" + encodeURIComponent(meldung));
  const fehler = (req, res, status, meldung) =>
    jsonGewuenscht(req) ? res.status(status).json({ fehler: meldung }) : res.redirect("/admin?meldung=" + encodeURIComponent(meldung));

  /* ---- Uebersicht ---- */
  r.get("/", async (req, res) => {
    const daten = await db.adminUebersicht();
    if (jsonGewuenscht(req)) return res.json(daten);
    res.type("html").send(seite(daten, req.query.meldung));
  });

  /* ---- Auszahlungen ---- */
  r.post("/auszahlungen/:id/freigeben", async (req, res) => {
    const a = await db.auszahlung(req.params.id).catch(() => null);
    if (!a || a.status !== "pruefung") return fehler(req, res, 404, "Auszahlung nicht gefunden oder nicht in Prüfung.");
    await db.protokoll(a.nutzer_id, "auszahlung_freigegeben", { beleg: a.beleg_nr, methode: a.methode }, "admin");
    const status = await auszahlungAusfuehren(a);
    return antwort(req, res, `${a.beleg_nr} freigegeben → ${status}`, { beleg: a.beleg_nr, status });
  });

  r.post("/auszahlungen/:id/ablehnen", async (req, res) => {
    const a = await db.auszahlung(req.params.id).catch(() => null);
    if (!a || !["pruefung", "laeuft"].includes(a.status)) return fehler(req, res, 404, "Auszahlung nicht gefunden oder schon erledigt.");
    const grund = String(req.body.grund || "vom Admin abgelehnt").slice(0, 200);
    await db.protokoll(a.nutzer_id, "auszahlung_admin_abgelehnt", { beleg: a.beleg_nr, grund }, "admin");
    const status = await auszahlungAbschliessen(a, { status: "abgelehnt", grund: "admin:" + grund });
    return antwort(req, res, `${a.beleg_nr} abgelehnt, Guthaben zurückgebucht`, { beleg: a.beleg_nr, status });
  });

  /* ---- Konten (Kennung = Nutzer-ID oder E-Mail, im Pfad oder als Feld "kennung") ---- */
  r.post(["/nutzer/sperren", "/nutzer/:id/sperren"], async (req, res) => {
    const n = await nutzerFinden(req.params.id || req.body.kennung);
    if (!n) return fehler(req, res, 404, "Konto nicht gefunden.");
    await db.nutzerSperren(n.id, String(req.body.grund || "vom Admin gesperrt").slice(0, 200), "admin");
    await db.sitzungenWiderrufen(n.id);
    return antwort(req, res, `Konto ${n.email} gesperrt`, { nutzerId: n.id });
  });

  r.post(["/nutzer/entsperren", "/nutzer/:id/entsperren"], async (req, res) => {
    const n = await nutzerFinden(req.params.id || req.body.kennung);
    if (!n) return fehler(req, res, 404, "Konto nicht gefunden.");
    await db.nutzerEntsperren(n.id, "admin");
    return antwort(req, res, `Konto ${n.email} entsperrt`, { nutzerId: n.id });
  });

  /* ---- Sperrliste ---- */
  r.post("/sperrliste", async (req, res) => {
    const typ = String(req.body.typ || "");
    const wert = String(req.body.wert || "").trim().toLowerCase();
    if (!["geraet", "ip", "auszahlziel", "email", "ausweis"].includes(typ) || !wert)
      return fehler(req, res, 400, "Typ oder Wert fehlt.");
    await db.aufSperrlisteSetzen(typ, wert, String(req.body.grund || "").slice(0, 200));
    await db.protokoll(null, "sperrliste", { typ, grund: req.body.grund || null }, "admin");   // Wert nur als Hash in der Sperrliste
    return antwort(req, res, `Sperrlisten-Eintrag (${typ}) gesetzt`);
  });

  async function nutzerFinden(kennung) {
    const k = String(kennung || "").trim();
    if (/^[0-9a-f-]{36}$/i.test(k)) return db.nutzer(k);
    if (k.includes("@")) return db.nutzerNachEmail(k.toLowerCase());
    return null;
  }

  return r;
}

/* ---- Seite ---- */
function seite({ auszahlungen, gesperrte, protokoll }, meldung) {
  const zeile = (a) => `
    <tr>
      <td><strong>${h(a.beleg_nr)}</strong><br><small>${h(wann(a.erstellt))}</small></td>
      <td>${h(a.email)}<br><small>${h(a.anzeigename)} · Tel ${a.telefon_bestaetigt ? "✓" : "–"} · Ausweis ${a.ausweis_geprueft ? "✓" : "–"}</small></td>
      <td>${h(a.methode)}<br><strong>${h(eur(a.betrag_eur))}</strong></td>
      <td><span class="p ${a.risiko_punkte >= 60 ? "rot" : a.risiko_punkte >= 30 ? "gelb" : "gruen"}">${h(a.risiko_punkte ?? "–")}</span>
          <small>${(a.treffer || []).map(h).join(", ") || "keine Treffer"}</small></td>
      <td class="aktionen">
        <form method="post" action="/admin/auszahlungen/${h(a.id)}/freigeben"><button class="ok">Freigeben</button></form>
        <form method="post" action="/admin/auszahlungen/${h(a.id)}/ablehnen"><input name="grund" placeholder="Grund"><button class="nein">Ablehnen</button></form>
        <form method="post" action="/admin/nutzer/${h(a.nutzer_id)}/sperren"><input name="grund" placeholder="Grund"><button class="nein">Konto sperren</button></form>
      </td>
    </tr>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoinCurb Admin</title>
<style>
  body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#f4f2ee;color:#1d1a26}
  header{background:#16131f;color:#f2ede3;padding:14px 22px;display:flex;justify-content:space-between;align-items:baseline}
  header b{letter-spacing:.3em;font-size:12px;color:#f5c242} main{padding:18px 22px;max-width:1200px;margin:0 auto}
  h2{font-size:15px;letter-spacing:.12em;text-transform:uppercase;margin:26px 0 10px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd8cf} td,th{padding:10px;border-top:1px solid #eee;vertical-align:top;text-align:left}
  small{color:#6c6353;display:block} .p{display:inline-block;min-width:34px;text-align:center;border-radius:6px;padding:2px 6px;font-weight:700;color:#fff}
  .gruen{background:#3fae7d}.gelb{background:#d9a52a}.rot{background:#e0563f}
  form{display:inline-flex;gap:6px;margin:0 6px 6px 0;align-items:center} input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;width:150px}
  select{padding:6px;border:1px solid #ccc;border-radius:6px} button{padding:6px 12px;border:0;border-radius:6px;cursor:pointer;font-weight:700}
  button.ok{background:#3fae7d;color:#fff} button.nein{background:#e0563f;color:#fff} button.neutral{background:#16131f;color:#fff}
  .meldung{background:#fff6d6;border:1px solid #e9c25a;padding:10px 12px;border-radius:8px;margin-bottom:16px}
  .leer{padding:16px;color:#6c6353} .box{background:#fff;border:1px solid #ddd8cf;padding:14px;border-radius:8px}
</style></head><body>
<header><span><b>COINCURB</b> &nbsp; Admin</span><span>${h(new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" }))}</span></header>
<main>
${meldung ? `<div class="meldung">${h(meldung)}</div>` : ""}
<h2>Auszahlungen in Prüfung (${auszahlungen.length})</h2>
${auszahlungen.length ? `<table><tr><th>Beleg</th><th>Konto</th><th>Weg</th><th>Risiko</th><th>Aktion</th></tr>${auszahlungen.map(zeile).join("")}</table>` : `<div class="box leer">Nichts offen.</div>`}

<h2>Konto sperren / entsperren</h2>
<div class="box">
  <form method="post" action="/admin/nutzer/sperren">
    <input name="kennung" placeholder="E-Mail oder Nutzer-ID" required><input name="grund" placeholder="Grund"><button class="nein">Sperren</button></form>
  <form method="post" action="/admin/nutzer/entsperren">
    <input name="kennung" placeholder="E-Mail oder Nutzer-ID" required><button class="ok">Entsperren</button></form>
  ${gesperrte.length ? `<table style="margin-top:10px"><tr><th>Gesperrt</th><th>Grund</th><th></th></tr>${gesperrte.map((n) => `<tr><td>${h(n.email)}<small>${h(n.id)}</small></td><td>${h(n.sperrgrund)}</td>
    <td><form method="post" action="/admin/nutzer/${h(n.id)}/entsperren"><button class="ok">Entsperren</button></form></td></tr>`).join("")}</table>` : ""}
</div>

<h2>Sperrliste</h2>
<div class="box"><form method="post" action="/admin/sperrliste">
  <select name="typ"><option value="auszahlziel">Auszahlungsziel</option><option value="email">E-Mail</option><option value="geraet">Gerät (Fingerprint)</option><option value="ip">IP</option><option value="ausweis">Ausweis</option></select>
  <input name="wert" placeholder="Wert" required><input name="grund" placeholder="Grund"><button class="neutral">Eintragen</button>
</form><small>Werte werden nur als Hash gespeichert.</small></div>

<h2>Protokoll (letzte ${protokoll.length})</h2>
<table><tr><th>Wann</th><th>Wer</th><th>Aktion</th><th>Details</th><th>Konto</th></tr>
${protokoll.map((p) => `<tr><td>${h(wann(p.erstellt))}</td><td>${h(p.wer)}</td><td>${h(p.aktion)}</td><td><small>${h(JSON.stringify(p.details))}</small></td><td><small>${h(p.email || p.nutzer_id || "")}</small></td></tr>`).join("")}
</table>
</main></body></html>`;
}
