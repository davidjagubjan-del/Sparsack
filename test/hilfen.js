/** Gemeinsame Hilfen: Nutzer anlegen, Guthaben setzen, Postbacks signieren. */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pg from "pg";

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

/** Postback-URL mit md5-Signatur (Variante "md5_konkat", z.B. adgate/torox/cpx). */
export function postbackUrl(partner, { user_id, transaction_id, payout, offer_name = "Testangebot", secret, pfad = "" }) {
  const signature = crypto.createHash("md5").update(`${user_id}${transaction_id}${payout}${secret}`).digest("hex");
  const q = new URLSearchParams({ user_id, transaction_id, payout: String(payout), offer_name, signature });
  return `/postback/${partner}${pfad}?${q}`;
}
