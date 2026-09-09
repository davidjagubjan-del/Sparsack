/**
 * Aufgabe 12 — Sign in with Apple: Identity-Token gegen JWKS pruefen (iss, aud, Signatur, Ablauf).
 * Die Tokens werden hier mit einem eigenen RS256-Schluessel signiert; das JWKS wird lokal eingehaengt.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import app from "../server.js";
import { db } from "../db.js";
import { apple, appleTokenPruefen } from "../auth.js";
import { pool, leeren, sql } from "./hilfen.js";

let schluessel, fremd;
beforeAll(async () => {
  schluessel = await generateKeyPair("RS256");
  fremd = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(schluessel.publicKey)), kid: "apple-test-1", alg: "RS256", use: "sig" };
  apple.jwks = createLocalJWKSet({ keys: [jwk] });
});
beforeEach(leeren);
afterAll(async () => { await db.schliessen(); await pool.end(); });

/** Token wie von Apple: iss, aud, sub, email, email_verified, exp */
async function appleToken({ sub = "001234.abcdef.5678", email = "relay@privaterelay.appleid.com", aud = "app.coincurb.ios",
                            iss = "https://appleid.apple.com", exp = "1h", key = schluessel.privateKey, alg = "RS256", verified = "true" } = {}) {
  const j = new SignJWT({ email, email_verified: verified, is_private_email: "true", auth_time: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg, kid: "apple-test-1" }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt();
  return exp === "abgelaufen" ? j.setExpirationTime(Math.floor(Date.now() / 1000) - 120).sign(key) : j.setExpirationTime(exp).sign(key);
}

describe("appleTokenPruefen", () => {
  it("gueltiges Token liefert sub und E-Mail", async () => {
    expect(await appleTokenPruefen(await appleToken())).toEqual({ sub: "001234.abcdef.5678", email: "relay@privaterelay.appleid.com", emailBestaetigt: true });
    expect((await appleTokenPruefen(await appleToken({ aud: "app.coincurb.web" }))).sub).toBe("001234.abcdef.5678");
  });

  it("manipuliert, fremder Schluessel, falscher aud/iss, abgelaufen, alg none → null", async () => {
    const t = await appleToken();
    const [h, p, sig] = t.split(".");
    expect(await appleTokenPruefen(`${h}.${p}.${sig.slice(0, -2)}AA`)).toBeNull();                 // Signatur veraendert
    const fremdePayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "anderer" })).toString("base64url");
    expect(await appleTokenPruefen(`${h}.${fremdePayload}.${sig}`)).toBeNull();                    // Payload veraendert
    expect(await appleTokenPruefen(await appleToken({ key: fremd.privateKey }))).toBeNull();      // nicht von Apple signiert
    expect(await appleTokenPruefen(await appleToken({ aud: "com.boese.app" }))).toBeNull();
    expect(await appleTokenPruefen(await appleToken({ iss: "https://accounts.google.com" }))).toBeNull();
    expect(await appleTokenPruefen(await appleToken({ exp: "abgelaufen" }))).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") + "." + p + ".";
    expect(await appleTokenPruefen(none)).toBeNull();
    expect(await appleTokenPruefen("")).toBeNull();
    expect(await appleTokenPruefen(undefined)).toBeNull();
  });

  it("ohne APPLE_BUNDLE_ID wird nichts akzeptiert", async () => {
    const alt = process.env.APPLE_BUNDLE_ID; process.env.APPLE_BUNDLE_ID = "";
    expect(await appleTokenPruefen(await appleToken())).toBeNull();
    process.env.APPLE_BUNDLE_ID = alt;
  });
});

describe("POST /api/anmelden/apple", () => {
  it("legt beim ersten Login ein Konto mit bestaetigter Mail an, danach dasselbe Konto", async () => {
    const r = await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken() });
    expect(r.status).toBe(200);
    expect(r.body.zugang).toBeDefined();
    expect(r.body.naechsterSchritt).toBe("telefon_bestaetigen");
    const ich = await request(app).get("/api/ich").set("Authorization", "Bearer " + r.body.zugang);
    expect(ich.body.verifiziert.mail).toBe(true);

    const r2 = await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken({ email: null }) });
    expect(r2.status).toBe(200);
    expect((await sql(`SELECT count(*)::int c FROM nutzer`)).rows[0].c).toBe(1);
  });

  it("manipuliertes Token → 401, kein Konto", async () => {
    const t = await appleToken({ key: fremd.privateKey });
    const r = await request(app).post("/api/anmelden/apple").send({ identityToken: t, email: "x@example.com" });
    expect(r.status).toBe(401);
    expect((await sql(`SELECT count(*)::int c FROM nutzer`)).rows[0].c).toBe(0);
  });

  it("E-Mail nur aus dem Body gilt als unbestaetigt; ohne E-Mail gibt es einen Platzhalter", async () => {
    const r = await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken({ email: null, sub: "sub-ohne-mail" }), email: "Body@Example.com" });
    expect(r.status).toBe(200);
    expect(r.body.naechsterSchritt).toBe("email_bestaetigen");
    const { rows: [n] } = await sql(`SELECT email, email_bestaetigt FROM nutzer WHERE apple_sub='sub-ohne-mail'`);
    expect(n).toEqual({ email: "body@example.com", email_bestaetigt: false });

    const r2 = await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken({ email: null, sub: "sub-leer" }) });
    expect(r2.status).toBe(200);
    expect((await sql(`SELECT email FROM nutzer WHERE apple_sub='sub-leer'`)).rows[0].email).toBe("sub-leer@apple.invalid");
  });

  it("gesperrtes Apple-Konto → 403", async () => {
    await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken({ sub: "gesperrt" }) });
    const { rows: [n] } = await sql(`SELECT id FROM nutzer WHERE apple_sub='gesperrt'`);
    await db.nutzerSperren(n.id, "Test");
    const r = await request(app).post("/api/anmelden/apple").send({ identityToken: await appleToken({ sub: "gesperrt" }) });
    expect(r.status).toBe(403);
  });
});
