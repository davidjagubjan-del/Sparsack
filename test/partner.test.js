/**
 * Aufgabe 5 — je Partner ein Postback im Format des Anbieters.
 * Fuer AyeT und BitLabs mit den in der Doku veroeffentlichten Beispielwerten.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app, { signaturen } from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, guthaben, buchungen, sql, postback, senden } from "./hilfen.js";

beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });

describe("Signaturformeln aus der Anbieter-Doku", () => {
  it("AyeT: Beispiel aus docs.ayetstudios.com (HMAC-SHA256, sortiert, form-encoded)", () => {
    // Parameter absichtlich unsortiert und mit %20 statt +, wie sie in einer URL ankommen koennen
    const roh = "user_id=testuser123456&transaction_id=8ee08f32ae611231b0a49d1bd66e9bf193132561&offer_name=TEST%20OFFER&payout=1.50&amount=0.10&click_id=1234abcd5678021";
    expect(signaturen.ayet(roh, "9f2228fea0d8e7ce10b2ac36053db14c"))
      .toBe("62a32725866780ada1dec3d62232645f2801e05a91df7b0202e9b780f804f04b");
  });

  it("BitLabs: Beispiel aus developer.bitlabs.ai (HMAC-SHA1 ueber die komplette URL)", () => {
    const url = "https://publisher.com/complete?uid=8cc877ee-af19-488d-b28d-216fb866b996&val=500";
    expect(signaturen.bitlabs(url, "JLOIAUNMHFli7ZJOQVEzm98rzqnm9")).toBe("dbcd6bb8ca677344592842a52b4fca9bec36cd4b");
    // mit angehaengtem &hash= identisch — der Hash-Teil wird abgeschnitten
    expect(signaturen.bitlabs(url + "&hash=dbcd6bb8ca677344592842a52b4fca9bec36cd4b", "JLOIAUNMHFli7ZJOQVEzm98rzqnm9"))
      .toBe("dbcd6bb8ca677344592842a52b4fca9bec36cd4b");
  });

  it("Torox: md5(oid-user_id-key)", () => {
    expect(signaturen.torox("4711", "u1", "k")).toMatch(/^[0-9a-f]{32}$/);
    expect(signaturen.torox("4711", "u1", "k")).toBe(signaturen.torox(4711, "u1", "k"));   // Zahl oder String egal
    expect(signaturen.torox("4711", "u1", "k")).not.toBe(signaturen.torox("4711", "u2", "k"));
  });

  it("Lootably: sha256(userID + ip + revenue + currencyReward + secret) ohne Trennzeichen", () => {
    const q = { user_id: "abc", ip: "1.2.3.4", payout: "0.50", reward: "300" };
    expect(signaturen.lootably(q, "geheim")).toMatch(/^[0-9a-f]{64}$/);
    expect(signaturen.lootably(q, "geheim")).not.toBe(signaturen.lootably({ ...q, payout: "5.00" }, "geheim"));
  });

  it("CPX: md5(trans_id-securehash)", () => {
    expect(signaturen.cpx("t1", "s")).toMatch(/^[0-9a-f]{32}$/);
    expect(signaturen.cpx("t1", "s")).not.toBe(signaturen.cpx("t2", "s"));
  });
});

describe("Ein Beispiel-Postback je Partner", () => {
  it("AdGate Media: token + IP-Liste, {state}=approved bucht, rejected storniert, pending wartet", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "ag-1", payout: "0.80", secret: process.env.ADGATE_SECRET };
    expect((await senden(app, "adgate", { ...f, state: "pending" })).status).toBe(200);
    expect(await buchungen(n.id)).toHaveLength(0);                       // pending: noch nichts
    const r = await senden(app, "adgate", f);
    expect(r.status).toBe(200);
    expect(r.text).toBe("ok");
    expect((await guthaben(n.id)).gesamt).toBe(480);                     // 0,80 * 1000 * 0,6
    expect((await senden(app, "adgate", { ...f, secret: "falscher-token" })).status).toBe(403);
    await senden(app, "adgate", { ...f, state: "rejected" });
    expect((await buchungen(n.id))[0].status).toBe("storniert");
  });

  it("AyeT: Signatur im Header X-Ayetstudios-Security-Hash, is_chargeback storniert", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "ay-1", payout: "1.25", offer_name: "Spiel Level 5", secret: process.env.AYET_SECRET };
    const r = await senden(app, "ayet", f);
    expect(r.status).toBe(200);
    expect((await guthaben(n.id)).gesamt).toBe(750);
    expect((await buchungen(n.id))[0].titel).toBe("Spiel Level 5");

    // gleicher Aufruf ohne Header oder mit manipuliertem Parameter → 403
    const { url } = postback("ayet", { ...f, transaction_id: "ay-2" });
    expect((await request(app).get(url)).status).toBe(403);
    const { url: u2, headers } = postback("ayet", { ...f, transaction_id: "ay-3" });
    expect((await request(app).get(u2.replace("payout=1.25", "payout=99")).set(headers)).status).toBe(403);
    expect(await buchungen(n.id)).toHaveLength(1);

    expect((await senden(app, "ayet", { ...f, chargeback: "1" })).status).toBe(200);
    expect((await buchungen(n.id))[0].status).toBe("storniert");
  });

  it("Torox: feste Parameter id/oid/user_id/payout/sig, negativer payout storniert", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "tx-77", payout: "2.00", offer_name: "App testen", secret: process.env.TOROX_SECRET };
    const ip = { "X-Forwarded-For": "203.0.113.5" };
    const r = await senden(app, "torox", f, ip);
    expect(r.status).toBe(200);
    const b = await buchungen(n.id);
    expect(b[0]).toMatchObject({ partner: "torox", partner_tx: "tx-77", titel: "App testen" });
    expect(Number(b[0].coins)).toBe(1200);
    expect((await senden(app, "torox", { ...f, transaction_id: "tx-78", secret: "falsch" }, ip)).status).toBe(403);
    expect((await senden(app, "torox", { ...f, payout: "-2.00" }, ip)).status).toBe(200);
    expect((await buchungen(n.id))[0].status).toBe("storniert");
  });

  it("Lootably: sha256-Hash ueber userID+ip+revenue+currencyReward, Antwort '1', status=0 storniert", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "lo-1", payout: "0.50", secret: process.env.LOOTABLY_SECRET };
    const r = await senden(app, "lootably", f);
    expect(r.status).toBe(200);
    expect(r.text).toBe("1");                                            // Lootably akzeptiert nur "1"
    expect((await guthaben(n.id)).gesamt).toBe(300);
    expect((await senden(app, "lootably", { ...f, transaction_id: "lo-2", ip: "9.9.9.9", secret: "falsch" })).status).toBe(403);
    expect((await senden(app, "lootably", { ...f, status: "0" })).status).toBe(200);
    expect((await buchungen(n.id))[0].status).toBe("storniert");
  });

  it("BitLabs: HMAC-SHA1 ueber die volle URL (POSTBACK_BASIS), RECONCILIATION mit REF storniert", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "bl-1", payout: "1.00", offer_name: "Umfrage 12 min", secret: process.env.BITLABS_SECRET };
    expect((await senden(app, "bitlabs", f)).status).toBe(200);
    expect((await guthaben(n.id)).gesamt).toBe(600);
    expect((await senden(app, "bitlabs", { ...f, transaction_id: "bl-2", hash: "0".repeat(40) })).status).toBe(403);
    expect((await senden(app, "bitlabs", { ...f, transaction_id: "bl-3", secret: "falsch" })).status).toBe(403);
    // Reconciliation: neue TX, REF zeigt auf die Originalbuchung, Wert negativ
    const r = await senden(app, "bitlabs", { ...f, transaction_id: "bl-9", ref: "bl-1", type: "RECONCILIATION", payout: "-1.00" });
    expect(r.status).toBe(200);
    const b = await buchungen(n.id);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ partner_tx: "bl-1", status: "storniert" });
  });

  it("CPX Research: md5(trans_id-securehash), status=2 storniert", async () => {
    const n = await nutzerAnlegen();
    const f = { user_id: n.id, transaction_id: "cpx-1", payout: "0.35", secret: process.env.CPX_SECRET };
    expect((await senden(app, "cpx", f)).status).toBe(200);
    expect((await guthaben(n.id)).gesamt).toBe(210);
    expect((await buchungen(n.id))[0].titel).toBe("Umfrage");
    expect((await senden(app, "cpx", { ...f, transaction_id: "cpx-2", secret: "falsch" })).status).toBe(403);
    expect((await senden(app, "cpx", { ...f, status: "2" })).status).toBe(200);
    expect((await buchungen(n.id))[0].status).toBe("storniert");
  });

  it("Partner ohne Secret in der .env nimmt gar nichts an", async () => {
    // torox ist konfiguriert; ein Partner-Eintrag ohne Secret wuerde 403 liefern — hier ueber leeren Token bei adgate
    const n = await nutzerAnlegen();
    const r = await senden(app, "adgate", { user_id: n.id, transaction_id: "x", payout: "1", secret: "" });
    expect(r.status).toBe(403);
  });

  it("Risiko-Verlauf wird bei jedem Partner geschrieben", async () => {
    const n = await nutzerAnlegen();
    await senden(app, "cpx", { user_id: n.id, transaction_id: "rv-1", payout: "1.00", secret: process.env.CPX_SECRET });
    const { rows } = await sql(`SELECT anlass FROM risiko_verlauf WHERE nutzer_id=$1`, [n.id]);
    expect(rows).toEqual([{ anlass: "postback" }]);
  });
});
