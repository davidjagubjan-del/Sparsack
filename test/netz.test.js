/**
 * Aufgabe 7 — Proxy-/VPN-Erkennung ueber IPQualityScore, 24-h-Cache, Ausfall = "unbekannt".
 * Der Dienst wird ueber ein gemocktes fetch simuliert.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db } from "../db.js";
import { netzTyp, netzTypAus } from "../auth.js";
import { pool, leeren, nutzerAnlegen, sql } from "./hilfen.js";

const antwort = (d, status = 200) => ({ ok: status < 400, status, json: async () => d });
const DATACENTER = { success: true, proxy: true, vpn: false, tor: false, active_vpn: false, active_tor: false,
  connection_type: "Data Center", country_code: "DE", fraud_score: 75 };

beforeEach(async () => { await leeren(); await sql(`TRUNCATE ip_netz`); process.env.IPQS_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await db.schliessen(); await pool.end(); });

describe("netzTypAus — Zuordnung der IPQS-Felder", () => {
  it("VPN/Tor vor Proxy vor Rechenzentrum, Mobil, Kabel, sonst unbekannt", () => {
    expect(netzTypAus({ vpn: true, connection_type: "Residential" })).toBe("vpn");
    expect(netzTypAus({ active_tor: true })).toBe("vpn");
    expect(netzTypAus({ proxy: true, connection_type: "Residential" })).toBe("rechenzentrum");
    expect(netzTypAus({ connection_type: "Data Center" })).toBe("rechenzentrum");
    expect(netzTypAus({ connection_type: "Mobile" })).toBe("mobil");
    expect(netzTypAus({ mobile: true, connection_type: "Residential" })).toBe("mobil");
    expect(netzTypAus({ connection_type: "Residential" })).toBe("kabel");
    expect(netzTypAus({ connection_type: "Corporate" })).toBe("kabel");
    expect(netzTypAus({ connection_type: "Premium required" })).toBe("unbekannt");
    expect(netzTypAus({})).toBe("unbekannt");
  });
});

describe("netzTyp", () => {
  it("bekannte Rechenzentrums-IP wird erkannt und 24 h gecacht (nur ein Aufruf beim Dienst)", async () => {
    const f = vi.fn().mockResolvedValue(antwort(DATACENTER));
    vi.stubGlobal("fetch", f);
    expect(await netzTyp("203.0.113.9")).toEqual({ typ: "rechenzentrum", land: "DE" });
    await new Promise((r) => setTimeout(r, 20));                // Cache-Schreiben laeuft nebenher
    expect(await netzTyp("203.0.113.9")).toEqual({ typ: "rechenzentrum", land: "DE" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/ipqualityscore\.com\/api\/json\/ip\/test-key\/203\.0\.113\.9\?/);

    const { rows } = await sql(`SELECT * FROM ip_netz`);
    expect(rows).toHaveLength(1);
    expect(rows[0].ip_hash).not.toContain("203.0.113");       // nur der Hash, nie die IP
    expect(rows[0].typ).toBe("rechenzentrum");
  });

  it("abgelaufener Cache wird neu geprueft", async () => {
    const f = vi.fn().mockResolvedValue(antwort({ success: true, connection_type: "Mobile", country_code: "AT" }));
    vi.stubGlobal("fetch", f);
    await db.netzMerken("203.0.113.10", "kabel", "DE");
    await sql(`UPDATE ip_netz SET geprueft = now() - interval '25 hours'`);
    expect(await netzTyp("203.0.113.10")).toEqual({ typ: "mobil", land: "AT" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("private Adressen und fehlender Key: kein Aufruf, unbekannt", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "::ffff:127.0.0.1", "fd00::1", ""])
      expect((await netzTyp(ip)).typ).toBe("unbekannt");
    delete process.env.IPQS_KEY;
    expect((await netzTyp("203.0.113.9")).typ).toBe("unbekannt");
    expect(f).not.toHaveBeenCalled();
  });

  it("Ausfall des Dienstes: Fehler, 5xx, success=false, kaputtes JSON → unbekannt, nichts gecacht, nie geworfen", async () => {
    const faelle = [
      vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      vi.fn().mockResolvedValue(antwort({}, 503)),
      vi.fn().mockResolvedValue(antwort({ success: false, message: "Invalid key" })),
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("kaputt"); } }),
    ];
    for (const f of faelle) {
      vi.stubGlobal("fetch", f);
      await expect(netzTyp("198.51.100.4")).resolves.toEqual({ typ: "unbekannt", land: null });
    }
    expect((await sql(`SELECT count(*)::int c FROM ip_netz`)).rows[0].c).toBe(0);
  });

  it("Timeout wird abgebrochen und ergibt unbekannt", async () => {
    process.env.IPQS_TIMEOUT_MS = "30";
    vi.stubGlobal("fetch", (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason))));
    const t0 = Date.now();
    expect((await netzTyp("198.51.100.5")).typ).toBe("unbekannt");
    expect(Date.now() - t0).toBeLessThan(1000);
    delete process.env.IPQS_TIMEOUT_MS;
  });
});

describe("Regel vpn", () => {
  it("Registrierung aus einem Rechenzentrum: ip_typ gespeichert, Regel vergibt 30 Punkte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(DATACENTER)));
    const r = await request(app).post("/api/registrieren")
      .set("X-Forwarded-For", "203.0.113.77").set("X-Device-Id", "geraet-abc")
      .send({ email: "dc@example.com", passwort: "zehnzeichenlang" });
    expect(r.status).toBe(200);

    const { rows } = await sql(`SELECT ip_typ, ip_land FROM nutzer_geraet`);
    expect(rows[0]).toEqual({ ip_typ: "rechenzentrum", ip_land: "DE" });

    const s = await request(app).get("/api/security").set("Authorization", "Bearer " + r.body.zugang);
    expect(s.body.signale).toContain("VPN, Proxy oder Server-IP");
    expect(s.body.punkte).toBeGreaterThanOrEqual(30);
  });

  it("Dienst nicht erreichbar: Anmeldung klappt trotzdem, Netztyp unbekannt, keine Punkte dafuer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const r = await request(app).post("/api/registrieren")
      .set("X-Forwarded-For", "203.0.113.78").set("X-Device-Id", "geraet-xyz")
      .send({ email: "ok@example.com", passwort: "zehnzeichenlang" });
    expect(r.status).toBe(200);
    expect((await sql(`SELECT ip_typ FROM nutzer_geraet`)).rows[0].ip_typ).toBe("unbekannt");
    const s = await request(app).get("/api/security").set("Authorization", "Bearer " + r.body.zugang);
    expect(s.body.signale).not.toContain("VPN, Proxy oder Server-IP");
  });

  it("Kennzahl fuer Nutzer ohne Geraet bleibt unbekannt", async () => {
    const n = await nutzerAnlegen();
    expect((await db.kennzahlenFuer(n.id)).ipTyp).toBe("unbekannt");
  });
});
