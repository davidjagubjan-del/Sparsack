import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../server.js";
import { db } from "../db.js";
import { pool, leeren, nutzerAnlegen, token, guthabenSetzen, guthaben, buchungen, sql } from "./hilfen.js";

beforeEach(leeren);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db.schliessen(); await pool.end(); });

const anfordern = (n, betrag, extra = {}) =>
  request(app).post("/api/auszahlung").set("Authorization", "Bearer " + token(n))
    .send({ methode: "paypal", ziel: "ich@example.com", betrag, ...extra });

describe("Auszahlung", () => {
  it("ohne Login: 401", async () => {
    const r = await request(app).post("/api/auszahlung").send({ methode: "paypal", ziel: "a@b.de", betrag: 5 });
    expect(r.status).toBe(401);
    const r2 = await request(app).post("/api/auszahlung").set("Authorization", "Bearer kaputt").send({ betrag: 5 });
    expect(r2.status).toBe(401);
  });

  it("Nutzer-ID kommt aus dem Token, nie aus dem Body", async () => {
    const opfer = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(opfer.id, 50000);
    const taeter = await nutzerAnlegen({ telefon: true });
    const r = await anfordern(taeter, 10, { nutzerId: opfer.id, user_id: opfer.id });
    expect(r.status).toBe(400);                       // taeter hat kein Guthaben
    expect((await guthaben(opfer.id)).frei).toBe(50000);
  });

  it("nicht freigeschaltete Methode: 400", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 50000);
    const r = await anfordern(n, 20, { methode: "bank", ziel: "DE89370400440532013000" });
    expect(r.status).toBe(400);
  });

  it("ohne bestaetigte Telefonnummer: 403", async () => {
    const n = await nutzerAnlegen({ telefon: false });
    await guthabenSetzen(n.id, 50000);
    expect((await anfordern(n, 10)).status).toBe(403);
  });

  it("Guthaben in Haltefrist zaehlt nicht", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await sql(`INSERT INTO buchungen (nutzer_id, art, coins, status, frei_ab) VALUES ($1,'aufgabe',50000,'haltefrist', now() + interval '1 day')`, [n.id]);
    const r = await anfordern(n, 10);
    expect(r.status).toBe(400);
    expect(r.body.fehler).toMatch(/Haltefrist/);
  });

  it("normale Auszahlung: Minus-Buchung, Beleg, Guthaben stimmt", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, 10);
    expect(r.status).toBe(200);
    expect(r.body.belegId).toMatch(/^AZ-\d{6}$/);
    expect(["laeuft", "pruefung"]).toContain(r.body.status);
    expect((await guthaben(n.id)).frei).toBe(10000);
    const { rows } = await sql(`SELECT * FROM auszahlungen WHERE nutzer_id=$1`, [n.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].betrag_eur)).toBe(10);
    expect(rows[0].ziel_hash).not.toBe("ich@example.com");
  });

  it("Doppelanfrage: genau eine kommt durch, die andere bekommt 409, Guthaben nie negativ", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 10000);               // reicht fuer genau eine 10-€-Auszahlung

    // Barriere: beide Anfragen haben die Vorpruefung gesehen (volles Guthaben), bevor eine bucht.
    // So wird der Wettlauf erzwungen, den ein echter Doppelklick nur manchmal trifft.
    let angekommen = 0, weiter;
    const barriere = new Promise((r) => (weiter = r));
    const echt = db.ausgezahltImMonat;
    vi.spyOn(db, "ausgezahltImMonat").mockImplementation(async (id) => {
      if (++angekommen === 2) weiter();
      await barriere;
      return echt(id);
    });

    const [a, b] = await Promise.all([anfordern(n, 10), anfordern(n, 10)]);
    const stati = [a.status, b.status].sort();
    expect(stati).toEqual([200, 409]);
    expect([a.body.fehler, b.body.fehler].filter(Boolean)[0]).toMatch(/noch einmal/);

    const g = await guthaben(n.id);
    expect(g.frei).toBe(0);
    const b_ = await buchungen(n.id);
    // Startguthaben, zwei Minus-Buchungen, eine Korrektur — nichts wurde per UPDATE veraendert
    expect(b_.map((x) => x.art)).toEqual(["aufgabe", "auszahlung", "auszahlung", "korrektur"]);
    const { rows } = await sql(`SELECT count(*)::int c FROM auszahlungen WHERE nutzer_id=$1`, [n.id]);
    expect(rows[0].c).toBe(1);
  });

  it("echter Doppelklick ohne Barriere: nie negativ, hoechstens eine Auszahlung", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 10000);
    const rs = await Promise.all([1, 2, 3].map(() => anfordern(n, 10)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of rs) expect([200, 400, 409]).toContain(r.status);
    expect((await guthaben(n.id)).frei).toBe(0);
    const { rows } = await sql(`SELECT count(*)::int c FROM auszahlungen WHERE nutzer_id=$1`, [n.id]);
    expect(rows[0].c).toBe(1);
  });

  it("Tageslimit 50 €: zweite Anfrage darueber bekommt 429", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 200000);              // 200 € frei
    expect((await anfordern(n, 30)).status).toBe(200);
    const r = await anfordern(n, 30);
    expect(r.status).toBe(429);
    expect(r.body.fehler).toMatch(/50 €/);
    expect((await guthaben(n.id)).frei).toBe(170000); // nur die erste wurde abgebucht
    expect((await anfordern(n, 20)).status).toBe(200); // genau bis 50 € geht noch
  });

  it("ab 100 € im Monat ohne Ausweis: 403", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 500000);
    vi.spyOn(db, "ausgezahltImMonat").mockResolvedValue(95);   // frueher im Monat schon 95 € ausgezahlt
    const r = await anfordern(n, 10);
    expect(r.status).toBe(403);
    expect(r.body.fehler).toMatch(/Ausweis/);
    expect((await guthaben(n.id)).frei).toBe(500000);

    const mitAusweis = await nutzerAnlegen({ telefon: true, ausweis: true });
    await guthabenSetzen(mitAusweis.id, 500000);
    expect((await anfordern(mitAusweis, 10)).status).toBe(200);
  });

  it("Mindestbetrag und Zielformat werden geprueft", async () => {
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 50000);
    expect((await anfordern(n, 4.99)).status).toBe(400);
    expect((await anfordern(n, 10, { ziel: "keine-mail" })).status).toBe(400);
    expect((await guthaben(n.id)).frei).toBe(50000);
  });
});
