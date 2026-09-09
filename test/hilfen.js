/** Gemeinsame Hilfen: Nutzer anlegen, Guthaben setzen, Postbacks je Partner signieren. */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pg from "pg";
import request from "supertest";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
export const sql = (text, params) => pool.query(text, params);

export async function leeren() {
  await sql(`TRUNCATE nutzer, geraete, sperrliste, protokoll RESTART IDENTITY CASCADE`);
}

let laufnr = 0;
export async function nutzerAnlegen({ telefon = false, ausweis = false } = {}) {
  const email = `n${++laufnr}-${Date.now()}@test.local`;
  const { rows: [n] } = await sql(
    `INSERT INTO nutzer (email, anzeigename, email_bestaetigt, telefon_bestaetigt, ausweis_geprueft)
     VALUES ($1, 'Test', TRUE, $2, $3) RETURNING *`, [email, telefon, ausweis]);
  return n;
}

export function token(nutzer) {
  return jwt.sign({ sub: nutzer.id }, process.env.JWT_SECRET, { expiresIn: "15m" });
}

/** Freies Guthaben in Coins direkt buchen (wie eine abgelaufene Haltefrist). */
export async function guthabenSetzen(nutzerId, coins) {
  await sql(`INSERT INTO buchungen (nutzer_id, art, coins, titel, status) VALUES ($1,'aufgabe',$2,'Test','frei')`,
    [nutzerId, coins]);
}

export async function guthaben(nutzerId) {
  const { rows: [g] } = await sql(`SELECT * FROM guthaben WHERE nutzer_id=$1`, [nutzerId]);
  return { gesamt: Number(g?.coins_gesamt || 0), frei: Number(g?.coins_frei || 0) };
}

export async function buchungen(nutzerId) {
  return (await sql(`SELECT * FROM buchungen WHERE nutzer_id=$1 ORDER BY id`, [nutzerId])).rows;
}

const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

/**
 * Baut einen Postback so, wie ihn der jeweilige Anbieter schickt (Parameternamen und Signatur nach Doku).
 * Rueckgabe: { url, headers }. `secret` = das Partner-Secret; `pfad` = "/storno" fuer die Storno-Route.
 * Zusaetzliche Felder (state, status, type, ref, oid, ip, reward ...) ueberschreiben die Standardwerte.
 */
export function postback(partner, { user_id, transaction_id, payout, offer_name = "Testangebot", secret, pfad = "", ...extra }) {
  const p = `/postback/${partner}${pfad}`;
  const headers = {};
  let query;

  if (partner === "adgate") {
    query = qs({ token: secret, user_id, transaction_id, payout, offer_name, state: "approved", ...extra });
  } else if (partner === "ayet") {
    // Signatur im Header ueber ALLE Parameter, alphabetisch sortiert, form-encoded
    const roh = qs({ user_id, transaction_id, payout, offer_name, chargeback: "0", ...extra });
    const sortiert = new URLSearchParams([...new URLSearchParams(roh)].sort((a, b) => (a[0] < b[0] ? -1 : 1))).toString();
    headers["X-Ayetstudios-Security-Hash"] = crypto.createHmac("sha256", secret).update(sortiert).digest("hex");
    query = roh;
  } else if (partner === "torox") {
    const oid = extra.oid ?? "4711";
    query = qs({ id: transaction_id, oid, user_id, amount: Math.round(Number(payout) * 600), payout, o_name: offer_name,
      currency_name: "Coins", sig: md5(`${oid}-${user_id}-${secret}`), ...extra });
  } else if (partner === "lootably") {
    const ip = extra.ip ?? "198.51.100.23", reward = extra.reward ?? Math.round(Number(payout) * 600);
    query = qs({ user_id, transaction_id, ip, payout, reward, offer_name, status: "1",
      signature: sha256(`${user_id}${ip}${payout}${reward}${secret}`), ...extra });
  } else if (partner === "bitlabs") {
    // HMAC-SHA1 ueber die komplette URL (Schema + Host + Pfad + Query) bis vor &hash=
    const roh = qs({ user_id, transaction_id, payout, type: "COMPLETE", ref: "", offer_name, ...extra });
    const voll = `${process.env.POSTBACK_BASIS}${p}?${roh}`;
    query = roh + "&hash=" + (extra.hash ?? crypto.createHmac("sha1", secret).update(voll).digest("hex"));
  } else if (partner === "cpx") {
    query = qs({ user_id, transaction_id, payout, status: "1", signature: md5(`${transaction_id}-${secret}`), ...extra });
  } else {
    query = qs({ user_id, transaction_id, payout, ...extra });
  }
  return { url: `${p}?${query}`, headers };
}

/** Postback abschicken; `kopf` = zusaetzliche Header (z.B. X-Forwarded-For fuer die IP-Liste). */
export function senden(app, partner, felder, kopf = {}) {
  const { url, headers } = postback(partner, felder);
  return request(app).get(url).set({ ...headers, ...kopf });
}
