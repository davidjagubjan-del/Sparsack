/** USD → EUR: Partner melden in Dollar, Coins gibt es fuer Euro (1.000 Coins = 1 €). */
import { describe, it, expect, beforeEach, afterAll } from "vitest";

process.env.USD_EUR = "0.5";                       // vor dem Import wirksam, eigene Datei = eigenes Modul
const { default: app } = await import("../server.js");
const { db } = await import("../db.js");
const { pool, leeren, nutzerAnlegen, guthaben, senden } = await import("./hilfen.js");

beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });

describe("USD_EUR", () => {
  it("rechnet den Payout vor der Coin-Berechnung um", async () => {
    const n = await nutzerAnlegen();
    await senden(app, "cpx", { user_id: n.id, transaction_id: "k1", payout: "2.00", secret: process.env.CPX_SECRET });
    expect((await guthaben(n.id)).gesamt).toBe(600);   // 2 USD * 0,5 = 1 € → 1000 Coins * 0,6
  });
});
