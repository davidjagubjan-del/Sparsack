/**
 * Aufgabe 6 — Verhaltens-Kennzahlen: Aufgabenstart melden, Dauer, Taktung, Pausen.
 * Daten werden mit festen Zeitstempeln konstruiert.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, token, sql } from "./hilfen.js";

beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });

/** Abschluss (Buchung) zu einem Zeitpunkt, optional mit Start `dauerSek` davor */
async function abschluss(n, { vorMin, dauerSek, partner = "cpx", angebot = "umfrage-1", erwartet = null, coins = 600 }) {
  const ende = `now() - interval '${vorMin} minutes'`;
  if (dauerSek != null)
    await sql(`INSERT INTO aufgaben_starts (nutzer_id, partner, angebot, erwartete_dauer_sek, gestartet)
               VALUES ($1,$2,$3,$4, ${ende} - interval '${dauerSek} seconds')`, [n.id, partner, angebot, erwartet]);
  await sql(`INSERT INTO buchungen (nutzer_id, art, coins, partner, partner_tx, status, erstellt)
             VALUES ($1,'aufgabe',$2,$3,$4,'haltefrist', ${ende})`, [n.id, coins, partner, `${partner}-${vorMin}-${Math.random()}`]);
}

const security = (n) => request(app).get("/api/security").set("Authorization", "Bearer " + token(n));

describe("POST /api/aufgabe/start", () => {
  it("ohne Login 401, mit Login wird der Start gespeichert", async () => {
    expect((await request(app).post("/api/aufgabe/start").send({ partner: "cpx" })).status).toBe(401);
    const n = await nutzerAnlegen();
    const r = await request(app).post("/api/aufgabe/start").set("Authorization", "Bearer " + token(n))
      .send({ partner: "bitlabs", angebot: "survey-42", erwarteteDauerSek: 720.4 });
    expect(r.status).toBe(200);
    const { rows } = await sql(`SELECT * FROM aufgaben_starts WHERE nutzer_id=$1`, [n.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partner: "bitlabs", angebot: "survey-42", erwartete_dauer_sek: 720 });
  });

  it("unbekannter Partner 400, Unsinn bei der Dauer wird ignoriert", async () => {
    const n = await nutzerAnlegen();
    const a = await request(app).post("/api/aufgabe/start").set("Authorization", "Bearer " + token(n)).send({ partner: "fremd" });
    expect(a.status).toBe(400);
    const b = await request(app).post("/api/aufgabe/start").set("Authorization", "Bearer " + token(n))
      .send({ partner: "cpx", erwarteteDauerSek: "quatsch" });
    expect(b.status).toBe(200);
    const { rows } = await sql(`SELECT erwartete_dauer_sek FROM aufgaben_starts WHERE nutzer_id=$1`, [n.id]);
    expect(rows[0].erwartete_dauer_sek).toBeNull();
  });
});

describe("Kennzahlen", () => {
  it("frischer Nutzer ist ueberall unauffaellig", async () => {
    const n = await nutzerAnlegen();
    const k = await db.kennzahlenFuer(n.id);
    expect(k).toMatchObject({ medianDauerSek: 999, erwarteteDauerSek: 999, gleicheAbstaende: false, stundenAmStueck: 0, anteilHighPayout: 0 });
    const r = await security(n);
    expect(r.body.signale).not.toContain(expect.stringMatching(/schnell|Bot-Muster|ohne Pause/));
  });

  it("zu_schnell: Abschluesse weit unter der gemeldeten Dauer", async () => {
    const n = await nutzerAnlegen();
    for (const vorMin of [300, 200, 100, 50])
      await abschluss(n, { vorMin, dauerSek: 20, erwartet: 600 });     // 20 s statt 10 min
    const k = await db.kennzahlenFuer(n.id);
    expect(k.medianDauerSek).toBe(20);
    expect(k.erwarteteDauerSek).toBe(600);
    const r = await security(n);
    expect(r.body.signale).toContain("Aufgaben werden unrealistisch schnell fertig");
    expect(r.body.punkte).toBeGreaterThanOrEqual(35);
  });

  it("zu_schnell: Vergleich mit anderen Nutzern zaehlt mehr als die gemeldete Dauer", async () => {
    // fuenf andere Nutzer brauchen ~10 Minuten fuer dasselbe Angebot
    for (let i = 0; i < 5; i++) {
      const a = await nutzerAnlegen();
      await abschluss(a, { vorMin: 60 + i, dauerSek: 600 + i * 10 });
    }
    const n = await nutzerAnlegen();
    for (const vorMin of [30, 20, 10]) await abschluss(n, { vorMin, dauerSek: 30, erwartet: 30 }); // meldet selbst "30 s"
    const k = await db.kennzahlenFuer(n.id);
    expect(k.medianDauerSek).toBe(30);
    expect(k.erwarteteDauerSek).toBe(620);
    expect((await security(n)).body.signale).toContain("Aufgaben werden unrealistisch schnell fertig");
  });

  it("zwei Messungen reichen nicht fuer ein Urteil", async () => {
    const n = await nutzerAnlegen();
    await abschluss(n, { vorMin: 20, dauerSek: 5, erwartet: 600 });
    await abschluss(n, { vorMin: 10, dauerSek: 5, erwartet: 600 });
    expect((await db.kennzahlenFuer(n.id)).medianDauerSek).toBe(999);
  });

  it("taktung: exakt gleiche Abstaende zwischen Abschluessen", async () => {
    const n = await nutzerAnlegen();
    for (let i = 8; i >= 1; i--) await abschluss(n, { vorMin: i * 5 });   // alle 5 Minuten
    const k = await db.kennzahlenFuer(n.id);
    expect(k.gleicheAbstaende).toBe(true);
    const r = await security(n);
    expect(r.body.signale).toContain("Immer exakt gleiche Abstaende zwischen Aktionen (Bot-Muster)");
  });

  it("taktung: menschlich unregelmaessige Abstaende schlagen nicht an", async () => {
    const n = await nutzerAnlegen();
    for (const vorMin of [190, 141, 120, 77, 60, 31, 12, 3]) await abschluss(n, { vorMin });
    expect((await db.kennzahlenFuer(n.id)).gleicheAbstaende).toBe(false);
  });

  it("kein_leerlauf: ueber 14 Stunden ohne 30-Minuten-Pause", async () => {
    const n = await nutzerAnlegen();
    for (let m = 15 * 60; m >= 0; m -= 20) await abschluss(n, { vorMin: m + 60 });   // 15 h lang alle 20 min
    const k = await db.kennzahlenFuer(n.id);
    expect(k.stundenAmStueck).toBeCloseTo(15, 0);
    expect((await security(n)).body.signale).toContain("Ueber 14 Stunden ohne Pause aktiv");
  });

  it("nur_high_payout: fast nur die teuersten Angebote (bei genug Vergleichsdaten)", async () => {
    for (let i = 0; i < 24; i++) {                    // Plattform: viele kleine Buchungen
      const a = await nutzerAnlegen();
      await abschluss(a, { vorMin: 100 + i, coins: 100 + i });
    }
    const n = await nutzerAnlegen();
    for (const vorMin of [90, 70, 50, 40, 20, 10]) await abschluss(n, { vorMin, coins: 5000 });
    const k = await db.kennzahlenFuer(n.id);
    expect(k.anteilHighPayout).toBe(1);
    expect((await security(n)).body.signale).toContain("Ausschliesslich die teuersten Angebote");
  });
});
