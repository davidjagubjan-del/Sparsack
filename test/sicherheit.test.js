import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db } from "../db.js";
import { pool } from "./hilfen.js";

afterAll(async () => { await db.schliessen(); await pool.end(); });

describe("Health-Check", () => {
  it("GET /gesund antwortet 200 mit Datenbank", async () => {
    const r = await request(app).get("/gesund");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});

describe("Aufgabe 2 — helmet + CORS", () => {
  it("setzt Security-Header", async () => {
    const r = await request(app).get("/api/ich");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBeDefined();
    expect(r.headers["strict-transport-security"]).toBeDefined();
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["referrer-policy"]).toBe("same-origin");
  });

  it("erlaubt die eigene Origin", async () => {
    const r = await request(app).get("/api/ich").set("Origin", "https://app.coincurb.test");
    expect(r.status).toBe(401);   // kein Token, aber CORS ok
    expect(r.headers["access-control-allow-origin"]).toBe("https://app.coincurb.test");
  });

  it("blockiert fremde Origins (auch Preflight)", async () => {
    const r = await request(app).get("/api/ich").set("Origin", "https://boese.example");
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.body.fehler).toMatch(/nicht erlaubt/);

    const pre = await request(app).options("/api/auszahlung")
      .set("Origin", "https://boese.example").set("Access-Control-Request-Method", "POST");
    expect(pre.status).toBe(403);
  });

  it("erlaubt die eigene Origin des Servers (same-origin-Formulare im Admin)", async () => {
    const r = await request(app).get("/api/ich").set("Host", "api.coincurb.test").set("Origin", "http://api.coincurb.test");
    expect(r.status).toBe(401);
    expect(r.headers["access-control-allow-origin"]).toBe("http://api.coincurb.test");
    const r2 = await request(app).get("/api/ich").set("Host", "api.coincurb.test").set("Origin", "http://api.coincurb.test.boese.example");
    expect(r2.status).toBe(403);
    expect((await request(app).get("/api/ich").set("Origin", "null")).status).toBe(403);
  });

  it("laesst Anfragen ohne Origin durch (Postbacks, native App)", async () => {
    const r = await request(app).get("/api/ich");
    expect(r.status).toBe(401);
  });

  it("weist zu grosse JSON-Bodies ab (50kb)", async () => {
    const r = await request(app).post("/api/anmelden")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@b.de", passwort: "x".repeat(60 * 1024) }));
    expect(r.status).toBe(413);
    expect(r.body.fehler).toBeDefined();
  });

  it("antwortet auf kaputtes JSON mit 400 statt Stacktrace", async () => {
    const r = await request(app).post("/api/anmelden").set("Content-Type", "application/json").send("{kaputt");
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/SyntaxError|at /);
  });
});
