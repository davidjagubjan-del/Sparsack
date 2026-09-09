import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app, { ipErlaubt } from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, guthaben, buchungen, sql, postback, senden } from "./hilfen.js";

const ADGATE = process.env.ADGATE_SECRET;
const TOROX = process.env.TOROX_SECRET;

beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });

describe("Postback — Gutschrift", () => {
  it("gueltige Signatur: bucht 60 % als Coins in Haltefrist und antwortet 200 ok", async () => {
    const n = await nutzerAnlegen();
    const r = await senden(app, "adgate", { user_id: n.id, transaction_id: "tx-1", payout: "1.50", secret: ADGATE });
    expect(r.status).toBe(200);
    expect(r.text).toBe("ok");

    const b = await buchungen(n.id);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ art: "aufgabe", partner: "adgate", partner_tx: "tx-1", status: "haltefrist", titel: "Testangebot" });
    expect(Number(b[0].coins)).toBe(900);          // 1,50 € * 1000 * 0,6
    const g = await guthaben(n.id);
    expect(g.gesamt).toBe(900);
    expect(g.frei).toBe(0);                        // noch in der Haltefrist
    const { rows: [rv] } = await sql(`SELECT * FROM risiko_verlauf WHERE nutzer_id=$1`, [n.id]);
    expect(rv.anlass).toBe("postback");
  });

  it("ungueltige Signatur: 403, nichts gebucht", async () => {
    const n = await nutzerAnlegen();
    const r = await senden(app, "adgate", { user_id: n.id, transaction_id: "tx-2", payout: "1.00", secret: "falsch" });
    expect(r.status).toBe(403);
    expect(await buchungen(n.id)).toHaveLength(0);

    // Signatur stimmt, aber payout wurde nachtraeglich veraendert (Lootably: Hash deckt revenue ab)
    const echt = postback("lootably", { user_id: n.id, transaction_id: "tx-3", payout: "1.00", secret: process.env.LOOTABLY_SECRET });
    const r2 = await request(app).get(echt.url.replace("payout=1.00", "payout=100.00"));
    expect(r2.status).toBe(403);
    expect(await buchungen(n.id)).toHaveLength(0);
  });

  it("Duplikat: zweite Meldung mit gleicher transaction_id antwortet 200, bucht aber nicht erneut", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "tx-dup", payout: "2.00", secret: ADGATE };
    expect((await senden(app, "adgate", f)).status).toBe(200);
    const r2 = await senden(app, "adgate", f);
    expect(r2.status).toBe(200);
    expect(r2.text).toBe("ok");
    expect(await buchungen(n.id)).toHaveLength(1);
    expect((await guthaben(n.id)).gesamt).toBe(1200);
  });

  it("Duplikate auch bei gleichzeitigen Meldungen (Unique-Index)", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "tx-race", payout: "1.00", secret: ADGATE };
    const rs = await Promise.all([1, 2, 3, 4].map(() => senden(app, "adgate", f)));
    for (const r of rs) expect(r.status).toBe(200);
    expect(await buchungen(n.id)).toHaveLength(1);
  });

  it("unbekannte oder kaputte user_id: 200 ok, keine Buchung", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "nicht-uuid", ""]) {
      const r = await senden(app, "adgate", { user_id: id, transaction_id: "tx-" + id, payout: "1.00", secret: ADGATE });
      expect(r.status).toBe(200);
      expect(r.text).toBe("ok");
    }
    expect((await sql(`SELECT count(*)::int c FROM buchungen`)).rows[0].c).toBe(0);
  });

  it("unbekannter Partner: 404", async () => {
    expect((await request(app).get("/postback/unbekannt?transaction_id=1")).status).toBe(404);
  });
});

describe("Aufgabe 3 — IP-Allowlist", () => {
  const von = (n, tx, ip) => senden(app, "torox", { user_id: n.id, transaction_id: tx, payout: "1.00", secret: TOROX },
    ip ? { "X-Forwarded-For": ip } : {});

  it("gelistete IPv4 darf, nicht gelistete bekommt 403", async () => {
    const n = await nutzerAnlegen();
    const ok = await von(n, "t1", "203.0.113.42");
    expect(ok.status).toBe(200);
    const nein = await von(n, "t2", "198.51.100.7");
    expect(nein.status).toBe(403);
    expect(nein.text).toMatch(/IP/);
    expect(await buchungen(n.id)).toHaveLength(1);
  });

  it("IPv6 wird gegen CIDR geprueft", async () => {
    const n = await nutzerAnlegen();
    expect((await von(n, "t3", "2001:db8:1::abcd")).status).toBe(200);
    expect((await von(n, "t4", "2001:db9::1")).status).toBe(403);
  });

  it("ohne Proxy-Header zaehlt die echte Verbindungs-IP (localhost ist nicht gelistet)", async () => {
    const n = await nutzerAnlegen();
    expect((await von(n, "t5")).status).toBe(403);
  });

  it("leere Liste erlaubt weiterhin alles", async () => {
    const n = await nutzerAnlegen();
    const r = await senden(app, "cpx", { user_id: n.id, transaction_id: "c1", payout: "1.00", secret: process.env.CPX_SECRET },
      { "X-Forwarded-For": "198.51.100.7" });
    expect(r.status).toBe(200);
  });

  it("Storno-Route haelt sich an dieselbe Liste", async () => {
    const n = await nutzerAnlegen();
    const r = await senden(app, "torox", { user_id: n.id, transaction_id: "t6", payout: "1.00", secret: TOROX, pfad: "/storno" },
      { "X-Forwarded-For": "198.51.100.7" });
    expect(r.status).toBe(403);
  });

  it("ipErlaubt: v4, v6, gemappte Adressen, Einzel-IPs, Muell", () => {
    expect(ipErlaubt("1.2.3.4", [])).toBe(true);
    expect(ipErlaubt("204.13.156.9", ["204.13.156.0/24"])).toBe(true);
    expect(ipErlaubt("::ffff:204.13.156.9", ["204.13.156.0/24"])).toBe(true);
    expect(ipErlaubt("204.13.157.9", ["204.13.156.0/24"])).toBe(false);
    expect(ipErlaubt("2a01:4f8::1", ["2a01:4f8::/32"])).toBe(true);
    expect(ipErlaubt("2a01:4f9::1", ["2a01:4f8::/32"])).toBe(false);
    expect(ipErlaubt("10.0.0.5", ["10.0.0.5"])).toBe(true);
    expect(ipErlaubt("quatsch", ["10.0.0.0/8"])).toBe(false);
    expect(ipErlaubt(undefined, ["10.0.0.0/8"])).toBe(false);
  });
});

describe("Storno", () => {
  it("Storno auf freie Buchung bucht den Betrag zurueck", async () => {
    const n = await nutzerAnlegen();
    await senden(app, "adgate", { user_id: n.id, transaction_id: "s1", payout: "2.00", secret: ADGATE });
    await sql(`UPDATE buchungen SET status='frei' WHERE partner_tx='s1'`);   // Haltefrist vorbei
    expect((await guthaben(n.id)).frei).toBe(1200);

    const r = await senden(app, "adgate", { user_id: n.id, transaction_id: "s1", payout: "2.00", secret: ADGATE, pfad: "/storno" });
    expect(r.status).toBe(200);
    const b = await buchungen(n.id);
    expect(b).toHaveLength(2);
    expect(b[0].status).toBe("storniert");
    expect(b[1]).toMatchObject({ art: "storno", status: "frei" });
    expect(Number(b[1].coins)).toBe(-1200);
    expect((await guthaben(n.id)).gesamt).toBe(-1200);   // Original zaehlt nicht mehr, Rueckbuchung schon
  });

  it("Storno in der Haltefrist (hier ueber state=rejected): nur als storniert markiert, keine Gegenbuchung", async () => {
    const n = await nutzerAnlegen();
    await senden(app, "adgate", { user_id: n.id, transaction_id: "s2", payout: "1.00", secret: ADGATE });
    await senden(app, "adgate", { user_id: n.id, transaction_id: "s2", payout: "1.00", secret: ADGATE, state: "rejected" });
    const b = await buchungen(n.id);
    expect(b).toHaveLength(1);
    expect(b[0].status).toBe("storniert");
    expect((await guthaben(n.id)).gesamt).toBe(0);
  });

  it("Storno mit falscher Signatur: 403, Buchung bleibt", async () => {
    const n = await nutzerAnlegen();
    await senden(app, "adgate", { user_id: n.id, transaction_id: "s3", payout: "1.00", secret: ADGATE });
    const r = await senden(app, "adgate", { user_id: n.id, transaction_id: "s3", payout: "1.00", secret: "falsch", pfad: "/storno" });
    expect(r.status).toBe(403);
    expect((await buchungen(n.id))[0].status).toBe("haltefrist");
  });
});
