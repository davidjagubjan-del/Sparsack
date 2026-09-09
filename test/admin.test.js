/** Aufgabe 14 — Admin-Bereich: Zugang, Freigabe/Ablehnung, Sperren, Sperrliste, Protokoll. */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, token, guthabenSetzen, guthaben, buchungen, sql, zahlungsMock } from "./hilfen.js";

const PW = "admin-test-passwort-1234";
const admin = (req) => req.auth("admin", PW);
const protokoll = async () => (await sql(`SELECT aktion, wer, details FROM protokoll ORDER BY id`)).rows;

beforeEach(async () => { await leeren(); vi.stubGlobal("fetch", zahlungsMock()); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db.schliessen(); await pool.end(); });

/** Auszahlung in Prüfung anlegen: gleiches Ziel bei zwei Konten → payout_geteilt (50 Punkte) */
async function auszahlungInPruefung() {
  const a = await nutzerAnlegen({ telefon: true }), b = await nutzerAnlegen({ telefon: true });
  await guthabenSetzen(a.id, 20000); await guthabenSetzen(b.id, 20000);
  const anf = (n) => request(app).post("/api/auszahlung").set("Authorization", "Bearer " + token(n)).send({ methode: "amazon", ziel: "gleich@example.com", betrag: 10 });
  await anf(a);
  const r = await anf(b);
  expect(r.body.status).toBe("pruefung");
  const { rows: [z] } = await sql(`SELECT * FROM auszahlungen WHERE nutzer_id=$1`, [b.id]);
  return { nutzer: b, auszahlung: z };
}

describe("Zugang", () => {
  it("ohne oder mit falschem Passwort 401 samt WWW-Authenticate, mit Passwort 200", async () => {
    const r = await request(app).get("/admin");
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toMatch(/Basic/);
    expect((await request(app).get("/admin").auth("admin", "falsch")).status).toBe(401);
    expect((await request(app).get("/admin").auth("root", PW)).status).toBe(401);
    const ok = await admin(request(app).get("/admin"));
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("CoinCurb Admin");
  });

  it("ohne ADMIN_PASSWORT bleibt alles zu (503)", async () => {
    const alt = process.env.ADMIN_PASSWORT; process.env.ADMIN_PASSWORT = "";
    expect((await admin(request(app).get("/admin"))).status).toBe(503);
    process.env.ADMIN_PASSWORT = "kurz";
    expect((await request(app).get("/admin").auth("admin", "kurz")).status).toBe(503);
    process.env.ADMIN_PASSWORT = alt;
  });

  it("POST von fremder Seite wird abgewiesen (CSRF)", async () => {
    const r = await admin(request(app).post("/admin/sperrliste")).set("Origin", "https://boese.example").send({ typ: "email", wert: "x@y.de" });
    expect(r.status).toBe(403);
    const r2 = await admin(request(app).post("/admin/sperrliste")).set("Sec-Fetch-Site", "cross-site").send({ typ: "email", wert: "x@y.de" });
    expect(r2.status).toBe(403);
    expect((await sql(`SELECT count(*)::int c FROM sperrliste`)).rows[0].c).toBe(0);
  });
});

describe("Auszahlungen", () => {
  it("Übersicht zeigt die Auszahlung in Prüfung mit Risiko-Treffern (HTML und JSON)", async () => {
    const { auszahlung } = await auszahlungInPruefung();
    const html = await admin(request(app).get("/admin"));
    expect(html.text).toContain(auszahlung.beleg_nr);
    expect(html.text).toContain("payout_geteilt");
    expect(html.text).toContain(`/admin/auszahlungen/${auszahlung.id}/freigeben`);
    expect(html.text).not.toContain("gleich@example.com");     // Ziel bleibt verschlüsselt, nie in der Übersicht
    const json = await admin(request(app).get("/admin")).set("Accept", "application/json");
    expect(json.body.auszahlungen).toHaveLength(1);
    expect(json.body.auszahlungen[0].treffer).toContain("payout_geteilt");
  });

  it("Freigeben per Klick (Formular) führt die Auszahlung aus und protokolliert den Admin", async () => {
    const { nutzer, auszahlung } = await auszahlungInPruefung();
    const r = await admin(request(app).post(`/admin/auszahlungen/${auszahlung.id}/freigeben`)).type("form").send({});
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/^\/admin\?meldung=/);
    const { rows: [a] } = await sql(`SELECT status, anbieter_ref FROM auszahlungen WHERE id=$1`, [auszahlung.id]);
    expect(a).toEqual({ status: "ausgezahlt", anbieter_ref: "RA-1" });
    const p = await protokoll();
    expect(p.find((x) => x.aktion === "auszahlung_freigegeben")).toMatchObject({ wer: "admin", details: { beleg: auszahlung.beleg_nr } });
    expect(p.find((x) => x.aktion === "auszahlung_ausgezahlt")).toBeDefined();
    expect((await guthaben(nutzer.id)).frei).toBe(10000);

    // zweiter Klick: schon erledigt
    const r2 = await admin(request(app).post(`/admin/auszahlungen/${auszahlung.id}/freigeben`)).set("Accept", "application/json").send({});
    expect(r2.status).toBe(404);
  });

  it("Ablehnen bucht das Guthaben zurück (JSON)", async () => {
    const { nutzer, auszahlung } = await auszahlungInPruefung();
    const r = await admin(request(app).post(`/admin/auszahlungen/${auszahlung.id}/ablehnen`)).send({ grund: "Mehrfachkonto" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "abgelehnt" });
    expect((await guthaben(nutzer.id)).frei).toBe(20000);
    expect((await buchungen(nutzer.id)).map((b) => b.art)).toEqual(["aufgabe", "auszahlung", "korrektur"]);
    const p = await protokoll();
    expect(p.find((x) => x.aktion === "auszahlung_admin_abgelehnt")).toMatchObject({ wer: "admin", details: { grund: "Mehrfachkonto" } });
  });
});

describe("Konten und Sperrliste", () => {
  it("sperren per E-Mail (widerruft Sitzungen), entsperren per ID, beides protokolliert", async () => {
    const n = await nutzerAnlegen();
    const r = await admin(request(app).post("/admin/nutzer/sperren")).send({ kennung: n.email, grund: "Bot" });
    expect(r.status).toBe(200);
    expect((await request(app).get("/api/ich").set("Authorization", "Bearer " + token(n))).status).toBe(403);
    const html = await admin(request(app).get("/admin"));
    expect(html.text).toContain(n.email);
    const r2 = await admin(request(app).post(`/admin/nutzer/${n.id}/entsperren`)).send({});
    expect(r2.status).toBe(200);
    expect((await request(app).get("/api/ich").set("Authorization", "Bearer " + token(n))).status).toBe(200);
    expect((await protokoll()).map((p) => p.aktion + ":" + p.wer)).toEqual(["sperre:admin", "entsperrt:admin"]);
    expect((await admin(request(app).post("/admin/nutzer/sperren")).send({ kennung: "niemand@example.com" })).status).toBe(404);
  });

  it("Sperrlisten-Eintrag greift sofort bei Registrierung und Auszahlung", async () => {
    const r = await admin(request(app).post("/admin/sperrliste")).send({ typ: "email", wert: "Boese@Example.com", grund: "Spam" });
    expect(r.status).toBe(200);
    expect(await db.aufSperrliste("email", "boese@example.com")).toBe(true);
    const reg = await request(app).post("/api/registrieren").send({ email: "boese@example.com", passwort: "zehnzeichenlang" });
    expect(reg.status).toBe(403);
    const p = await protokoll();
    expect(p[0]).toMatchObject({ aktion: "sperrliste", wer: "admin", details: { typ: "email" } });
    expect(JSON.stringify(p[0].details)).not.toContain("boese");
    expect((await admin(request(app).post("/admin/sperrliste")).send({ typ: "quatsch", wert: "x" })).status).toBe(400);
  });
});
