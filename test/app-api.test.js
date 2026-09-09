/** Aufgabe 13 — was die App vom Backend braucht: Waende, Auszahlungswege, Verlauf. */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, token, guthabenSetzen, sql } from "./hilfen.js";

beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });
const get = (pfad, n) => request(app).get(pfad).set("Authorization", "Bearer " + token(n));

describe("GET /api/walls", () => {
  it("nur Partner mit eingetragener ID, Links mit Nutzer-ID, CPX signiert", async () => {
    const n = await nutzerAnlegen();
    const r = await get("/api/walls", n);
    expect(r.status).toBe(200);
    expect(r.body.map((w) => w.id).sort()).toEqual(["bitlabs", "cpx"]);
    const cpx = r.body.find((w) => w.id === "cpx");
    expect(cpx).toMatchObject({ name: "CPX Research", typ: "Umfragen", appInstalls: false });
    const u = new URL(cpx.url);
    expect(u.searchParams.get("app_id")).toBe("4242");
    expect(u.searchParams.get("ext_user_id")).toBe(n.id);
    expect(u.searchParams.get("secure_hash")).toBe(crypto.createHash("md5").update(`${n.id}-${process.env.CPX_SECRET}`).digest("hex"));
    const bl = r.body.find((w) => w.id === "bitlabs");
    expect(bl.url).toBe(`https://web.bitlabs.ai/?token=bl-token&uid=${n.id}`);
  });
  it("ohne Login 401", async () => {
    expect((await request(app).get("/api/walls")).status).toBe(401);
  });

  it("Aufgabe 16: derselbe Server zeigt iOS nur Umfrage-Partner, Android und Web alles Konfigurierte", async () => {
    process.env.ADGATE_WALL_ID = "wall-1";       // Offerwall mit App-Installationen dazu schalten
    const n = await nutzerAnlegen();
    const ids = async (plattform) => (await get("/api/walls", n).set("X-Platform", plattform)).body.map((w) => w.id).sort();
    expect(await ids("android")).toEqual(["adgate", "bitlabs", "cpx"]);
    expect(await ids("web")).toEqual(["adgate", "bitlabs", "cpx"]);
    expect(await ids("ios")).toEqual(["bitlabs", "cpx"]);
    expect(await ids("iOS")).toEqual(["bitlabs", "cpx"]);
    expect((await get("/api/walls", n)).body.map((w) => w.id).sort()).toEqual(["adgate", "bitlabs", "cpx"]);   // kein Header = web
    for (const w of (await get("/api/walls", n).set("X-Platform", "ios")).body) expect(w.appInstalls).toBe(false);
    process.env.ADGATE_WALL_ID = "";
  });
});

describe("GET /api/auszahlung/wege", () => {
  it("liefert die freigeschalteten Wege mit Minimum und Gebuehr", async () => {
    const n = await nutzerAnlegen();
    const r = await get("/api/auszahlung/wege", n);
    expect(r.body).toEqual([
      { id: "paypal", min: 5, gebuehr: 0 }, { id: "amazon", min: 5, gebuehr: 0 }, { id: "steam", min: 5, gebuehr: 0 }]);
  });
});

describe("GET /api/verlauf", () => {
  it("letzte Buchungen und Auszahlungen, nur die eigenen", async () => {
    const n = await nutzerAnlegen(), fremd = await nutzerAnlegen();
    await guthabenSetzen(n.id, 1000);
    await guthabenSetzen(fremd.id, 9999);
    await sql(`INSERT INTO auszahlungen (beleg_nr, nutzer_id, methode, ziel, ziel_hash, betrag_eur, status)
               VALUES ('AZ-000001',$1,'amazon',pgp_sym_encrypt('x@y.de',$2),'h',5,'laeuft')`, [n.id, process.env.ZIEL_SCHLUESSEL]);
    const r = await get("/api/verlauf", n);
    expect(r.status).toBe(200);
    expect(r.body.buchungen).toHaveLength(1);
    expect(Number(r.body.buchungen[0].coins)).toBe(1000);
    expect(r.body.auszahlungen).toEqual([expect.objectContaining({ beleg_nr: "AZ-000001", methode: "amazon", status: "laeuft" })]);
    expect(JSON.stringify(r.body)).not.toContain("x@y.de");
  });
});
