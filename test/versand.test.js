/**
 * Aufgabe 11 — Mail ueber Resend, SMS-Codes ueber Twilio Verify (beide gemockt).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db, hash } from "../db.js";
import { mail, sms } from "../versand.js";
import { pool, leeren, nutzerAnlegen, token, sql, guthaben } from "./hilfen.js";

/** Mock fuer Resend + Twilio; jeder Aufruf wird mitgeschrieben */
function versandMock({ resendStatus = 200, twilioCheck = "approved", twilioStatus = 200 } = {}) {
  const aufrufe = [];
  const f = async (url, opt = {}) => {
    aufrufe.push({ url, methode: opt.method, headers: opt.headers, body: opt.body });
    const antwort = (status, d) => ({ ok: status < 400, status, text: async () => JSON.stringify(d), json: async () => d });
    if (url === "https://api.resend.com/emails") return antwort(resendStatus, resendStatus < 400 ? { id: "mail-1" } : { name: "validation_error", message: "Invalid `to`: kaputt@x.de" });
    if (url.endsWith("/Verifications")) return antwort(twilioStatus, twilioStatus < 400 ? { status: "pending" } : { code: 60200, message: "Invalid parameter `To`: +49 170" });
    if (url.endsWith("/VerificationCheck")) return twilioCheck === 404 ? antwort(404, { code: 20404, message: "not found" }) : antwort(200, { status: twilioCheck });
    return antwort(404, {});
  };
  f.aufrufe = aufrufe;
  return f;
}

beforeEach(leeren);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db.schliessen(); await pool.end(); });

const registrieren = (email = "neu@example.com") =>
  request(app).post("/api/registrieren").send({ email, passwort: "zehnzeichenlang", anzeigename: "Neu" });

describe("Mail ueber Resend", () => {
  it("Registrierung schickt die Bestaetigungsmail: Bearer-Key, Absender, Empfaenger, Link mit Code", async () => {
    const f = versandMock(); vi.stubGlobal("fetch", f);
    const r = await registrieren();
    expect(r.status).toBe(200);
    const m = f.aufrufe.find((a) => a.url.includes("resend"));
    expect(m.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(m.body);
    expect(body).toMatchObject({ from: "CoinCurb <no-reply@coincurb.test>", to: ["neu@example.com"] });
    expect(body.subject).toMatch(/Bestätige/);
    const link = body.text.match(/https:\/\/app\.coincurb\.test\/bestaetigen\?c=([A-Za-z0-9_-]+)/);
    expect(link).not.toBeNull();

    // Der Link aus der Mail bestaetigt die Adresse und bringt den Willkommensbonus
    const b = await request(app).get("/api/email/bestaetigen?c=" + link[1]);
    expect(b.status).toBe(200);
    const { rows: [n] } = await sql(`SELECT * FROM nutzer WHERE email='neu@example.com'`);
    expect(n.email_bestaetigt).toBe(true);
    expect((await guthaben(n.id)).gesamt).toBe(500);
    expect((await request(app).get("/api/email/bestaetigen?c=" + link[1])).status).toBe(400);   // nur einmal
  });

  it("Resend-Fehler: Registrierung klappt trotzdem, Fehler im Protokoll ohne Adresse, Mail spaeter neu anfordern", async () => {
    vi.stubGlobal("fetch", versandMock({ resendStatus: 422 }));
    const r = await registrieren("kaputt@x.de");
    expect(r.status).toBe(200);
    const { rows: [p] } = await sql(`SELECT * FROM protokoll WHERE aktion='mail_fehler'`);
    expect(p.details.fehler).toMatch(/resend: HTTP 422/);
    expect(JSON.stringify(p.details)).not.toContain("kaputt@x.de");

    const f = versandMock(); vi.stubGlobal("fetch", f);
    const e = await request(app).post("/api/email/erneut").set("Authorization", "Bearer " + r.body.zugang);
    expect(e.status).toBe(200);
    expect(f.aufrufe.filter((a) => a.url.includes("resend"))).toHaveLength(1);
    expect((await sql(`SELECT count(*)::int c FROM codes WHERE zweck='email'`)).rows[0].c).toBe(2);
  });

  it("ohne RESEND_KEY wird nichts verschickt und nichts geworfen", async () => {
    const f = versandMock(); vi.stubGlobal("fetch", f);
    const key = process.env.RESEND_KEY; delete process.env.RESEND_KEY;
    expect(await mail.senden("a@b.de", "x", "y")).toBe(false);
    expect(f.aufrufe).toHaveLength(0);
    process.env.RESEND_KEY = key;
  });

  it("schon bestaetigt: erneut anfordern gibt 400", async () => {
    const n = await nutzerAnlegen();
    const e = await request(app).post("/api/email/erneut").set("Authorization", "Bearer " + token(n));
    expect(e.status).toBe(400);
  });
});

describe("SMS-Code ueber Twilio Verify", () => {
  it("Code anfordern: Twilio Verifications mit Basic-Auth, To in E.164, Channel sms", async () => {
    const f = versandMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen();
    const r = await request(app).post("/api/telefon/code").set("Authorization", "Bearer " + token(n)).send({ telefon: "+49 170 123 4567" });
    expect(r.status).toBe(200);
    const t = f.aufrufe[0];
    expect(t.url).toBe("https://verify.twilio.com/v2/Services/VAtest/Verifications");
    expect(t.headers.Authorization).toBe("Basic " + Buffer.from("ACtest:twilio-token").toString("base64"));
    expect(new URLSearchParams(t.body).get("To")).toBe("+491701234567");
    expect(new URLSearchParams(t.body).get("Channel")).toBe("sms");
    expect((await sql(`SELECT count(*)::int c FROM codes WHERE zweck='telefon'`)).rows[0].c).toBe(0);   // kein Code bei uns
  });

  it("Code pruefen: approved → Nummer als Hash gespeichert und bestaetigt", async () => {
    const f = versandMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen();
    const r = await request(app).post("/api/telefon/pruefen").set("Authorization", "Bearer " + token(n))
      .send({ telefon: "0049 170 1234567", code: "123456" });
    expect(r.status).toBe(200);
    expect(new URLSearchParams(f.aufrufe[0].body).get("Code")).toBe("123456");
    const { rows: [u] } = await sql(`SELECT telefon, telefon_bestaetigt FROM nutzer WHERE id=$1`, [n.id]);
    expect(u.telefon_bestaetigt).toBe(true);
    expect(u.telefon).toBe(hash("+491701234567"));
    expect(u.telefon).not.toContain("1234567");
  });

  it("falscher oder abgelaufener Code → 400, Nummer nicht gesetzt", async () => {
    const n = await nutzerAnlegen();
    for (const fall of ["pending", 404]) {
      vi.stubGlobal("fetch", versandMock({ twilioCheck: fall }));
      const r = await request(app).post("/api/telefon/pruefen").set("Authorization", "Bearer " + token(n))
        .send({ telefon: "+491701234567", code: "000000" });
      expect(r.status).toBe(400);
    }
    expect((await sql(`SELECT telefon_bestaetigt FROM nutzer WHERE id=$1`, [n.id])).rows[0].telefon_bestaetigt).toBe(false);
  });

  it("Nummer schon bei anderem Konto → 409; kaputte Nummer → 400; Twilio-Fehler → 502 ohne Nummer im Protokoll", async () => {
    vi.stubGlobal("fetch", versandMock());
    const a = await nutzerAnlegen(), b = await nutzerAnlegen();
    await db.telefonBestaetigt(a.id, "+491701234567");
    const r = await request(app).post("/api/telefon/code").set("Authorization", "Bearer " + token(b)).send({ telefon: "+491701234567" });
    expect(r.status).toBe(409);
    const r2 = await request(app).post("/api/telefon/code").set("Authorization", "Bearer " + token(b)).send({ telefon: "0170 1234567" });
    expect(r2.status).toBe(400);

    vi.stubGlobal("fetch", versandMock({ twilioStatus: 400 }));
    const r3 = await request(app).post("/api/telefon/code").set("Authorization", "Bearer " + token(b)).send({ telefon: "+491709999999" });
    expect(r3.status).toBe(502);
    const { rows: [p] } = await sql(`SELECT details FROM protokoll WHERE aktion='sms_fehler'`);
    expect(p.details.fehler).toMatch(/twilio: HTTP 400/);
    expect(JSON.stringify(p.details)).not.toMatch(/49 ?170/);
  });

  it("ohne Twilio-Konfiguration → 503, kein Aufruf", async () => {
    const f = versandMock(); vi.stubGlobal("fetch", f);
    const sid = process.env.TWILIO_VERIFY_SID; delete process.env.TWILIO_VERIFY_SID;
    expect(sms.eingerichtet()).toBe(false);
    const n = await nutzerAnlegen();
    const r = await request(app).post("/api/telefon/code").set("Authorization", "Bearer " + token(n)).send({ telefon: "+491701234567" });
    expect(r.status).toBe(503);
    expect(f.aufrufe).toHaveLength(0);
    process.env.TWILIO_VERIFY_SID = sid;
  });
});
