/**
 * Block C — PayPal Payouts (8), Gutscheine ueber Tango Card (9), verschluesselte Ziele (10).
 * Die Dienste sind ueber zahlungsMock() ersetzt; geprueft wird, was wir schicken und was daraus wird.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import app, { auszahlungenNachpruefen, auszahlungAusfuehren } from "../server.js";
import { db } from "../db.js";
import { paypal, tango, Dienstfehler } from "../auszahlung.js";
import { pool, leeren, nutzerAnlegen, token, guthabenSetzen, guthaben, buchungen, sql, zahlungsMock } from "./hilfen.js";

beforeEach(async () => { await leeren(); paypal.vergessen(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await db.schliessen(); await pool.end(); });

const anfordern = (n, methode, betrag = 10, ziel = "empfaenger@example.com") =>
  request(app).post("/api/auszahlung").set("Authorization", "Bearer " + token(n)).send({ methode, ziel, betrag });
const auftrag = async (n) => (await sql(`SELECT * FROM auszahlungen WHERE nutzer_id=$1 ORDER BY erstellt DESC LIMIT 1`, [n.id])).rows[0];
const protokoll = async (n) => (await sql(`SELECT aktion, details FROM protokoll WHERE nutzer_id=$1 ORDER BY id`, [n.id])).rows;

describe("Aufgabe 8 — PayPal Payouts", () => {
  it("holt ein Token (Basic) und schickt einen Batch (Bearer, PayPal-Request-Id = Beleg), Batch-ID als anbieter_ref", async () => {
    const f = zahlungsMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, "paypal", 12.5);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("laeuft");                        // PENDING → bleibt laufend, Nachpruefung kommt

    const [tok, pay] = f.aufrufe;
    expect(tok.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(tok.headers.Authorization).toBe("Basic " + Buffer.from("pp-client:pp-secret").toString("base64"));
    expect(tok.roh).toBe("grant_type=client_credentials");
    expect(pay.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(pay.headers.Authorization).toBe("Bearer tok-1");
    expect(pay.headers["PayPal-Request-Id"]).toBe(r.body.belegId);
    expect(pay.body.sender_batch_header.sender_batch_id).toBe(r.body.belegId);
    expect(pay.body.items).toEqual([expect.objectContaining({
      recipient_type: "EMAIL", receiver: "empfaenger@example.com", sender_item_id: r.body.belegId,
      amount: { value: "12.50", currency: "EUR" } })]);

    const a = await auftrag(n);
    expect(a).toMatchObject({ status: "laeuft", anbieter_ref: "BATCH-1", methode: "paypal" });
    expect(a.erledigt).toBeNull();
    expect((await guthaben(n.id)).frei).toBe(7500);
  });

  it("Token wird wiederverwendet, bis es ablaeuft", async () => {
    const f = zahlungsMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    expect((await anfordern(n, "paypal", 10)).body.status).toBe("laeuft");
    expect((await anfordern(n, "paypal", 10)).body.status).toBe("laeuft");
    expect(f.aufrufe.filter((a) => a.url.endsWith("/oauth2/token"))).toHaveLength(1);
    expect(f.aufrufe.filter((a) => a.url.endsWith("/payments/payouts"))).toHaveLength(2);
  });

  it("Nachpruefung: SUCCESS → ausgezahlt mit Zeitstempel und Protokoll, nichts doppelt", async () => {
    vi.stubGlobal("fetch", zahlungsMock());
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    await anfordern(n, "paypal", 10);
    await auszahlungenNachpruefen();
    await auszahlungenNachpruefen();                             // zweiter Lauf findet nichts Offenes mehr
    const a = await auftrag(n);
    expect(a.status).toBe("ausgezahlt");
    expect(a.erledigt).not.toBeNull();
    expect((await protokoll(n)).map((p) => p.aktion)).toEqual(["auszahlung_ausgezahlt"]);
    expect((await guthaben(n.id)).frei).toBe(10000);
  });

  it("Nachpruefung: DENIED → abgelehnt, Guthaben kommt als Korrektur-Buchung zurueck (kein UPDATE an Betraegen)", async () => {
    vi.stubGlobal("fetch", zahlungsMock({ status: { batch_header: { payout_batch_id: "BATCH-1", batch_status: "DENIED" }, items: [{ transaction_status: "FAILED" }] } }));
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    await anfordern(n, "paypal", 10);
    expect((await guthaben(n.id)).frei).toBe(10000);
    await auszahlungenNachpruefen();
    await auszahlungenNachpruefen();
    expect((await auftrag(n)).status).toBe("abgelehnt");
    expect((await guthaben(n.id)).frei).toBe(20000);
    const b = await buchungen(n.id);
    expect(b.map((x) => x.art)).toEqual(["aufgabe", "auszahlung", "korrektur"]);   // genau eine Rueckbuchung
    const p = await protokoll(n);
    expect(p[0].aktion).toBe("auszahlung_abgelehnt");
    expect(p[0].details.grund).toBe("paypal:FAILED");
  });

  it("Dienst antwortet mit Fehler oder ist nicht erreichbar → sofort abgelehnt, Guthaben zurueck, Fehler ohne E-Mail im Protokoll", async () => {
    vi.stubGlobal("fetch", zahlungsMock({ payout: { name: "VALIDATION_ERROR", message: "receiver empfaenger@example.com invalid" } }));
    // Mock liefert fuer payout einen Fehler-Body mit Status 201 → wir erzwingen einen 4xx ueber eine Funktion
    vi.stubGlobal("fetch", zahlungsMock({ payout: () => ({ ok: false, status: 422,
      text: async () => JSON.stringify({ name: "VALIDATION_ERROR", message: "receiver empfaenger@example.com invalid" }) }) }));
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, "paypal", 10);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("abgelehnt");
    expect(r.body.hinweis).toMatch(/Guthaben ist wieder da/);
    expect((await guthaben(n.id)).frei).toBe(20000);
    const p = await protokoll(n);
    expect(p.map((x) => x.aktion)).toEqual(["auszahlung_fehler", "auszahlung_abgelehnt"]);
    expect(JSON.stringify(p)).not.toContain("empfaenger@example.com");
    expect(JSON.stringify(p)).toContain("VALIDATION_ERROR");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r2 = await anfordern(n, "paypal", 10);
    expect(r2.body.status).toBe("abgelehnt");
    expect((await guthaben(n.id)).frei).toBe(20000);
  });

  it("deuten(): PayPal-Status → unserer", () => {
    const d = (batch, item) => ({ batch_header: { payout_batch_id: "B", batch_status: batch }, items: item ? [{ transaction_status: item }] : [] });
    expect(paypal.deuten(d("SUCCESS", "SUCCESS")).status).toBe("ausgezahlt");
    expect(paypal.deuten(d("PROCESSING", "PENDING")).status).toBe("laeuft");
    expect(paypal.deuten(d("SUCCESS", "UNCLAIMED")).status).toBe("laeuft");
    expect(paypal.deuten(d("SUCCESS", "RETURNED")).status).toBe("abgelehnt");
    expect(paypal.deuten(d("DENIED")).status).toBe("abgelehnt");
    expect(paypal.deuten(d("PENDING")).status).toBe("laeuft");
  });

  it("Umgebung: live schaltet auf api-m.paypal.com", () => {
    process.env.PAYPAL_UMGEBUNG = "live";
    expect(paypal.basis()).toBe("https://api-m.paypal.com");
    process.env.PAYPAL_UMGEBUNG = "sandbox";
    expect(paypal.basis()).toBe("https://api-m.sandbox.paypal.com");
  });
});

describe("Aufgabe 9 — Gutscheine ueber Tango Card", () => {
  it("Amazon: Bestellung mit Basic-Auth, UTID, EMAIL-Zustellung, externalRefID = Beleg; Code landet nirgends", async () => {
    const f = zahlungsMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, "amazon", 15);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ausgezahlt");

    const [o] = f.aufrufe;
    expect(o.url).toBe("https://integration-api.tangocard.com/raas/v2/orders");
    expect(o.headers.Authorization).toBe("Basic " + Buffer.from("coincurb-test:tango-key").toString("base64"));
    expect(o.body).toMatchObject({ accountIdentifier: "konto-1", customerIdentifier: "kunde-1", utid: "U-AMAZON-DE",
      amount: 15, deliveryMethod: "EMAIL", externalRefID: r.body.belegId, recipient: { email: "empfaenger@example.com" } });

    const a = await auftrag(n);
    expect(a).toMatchObject({ status: "ausgezahlt", anbieter_ref: "RA-1", methode: "amazon" });
    // Der Claim-Code aus der Antwort darf in keiner Tabelle auftauchen
    for (const t of ["auszahlungen", "protokoll", "buchungen"]) {
      const { rows } = await sql(`SELECT count(*)::int c FROM ${t} WHERE ${t}::text LIKE '%GEHEIM-CODE%'`);
      expect(rows[0].c).toBe(0);
    }
  });

  it("Steam analog mit eigener UTID", async () => {
    const f = zahlungsMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    expect((await anfordern(n, "steam", 10)).body.status).toBe("ausgezahlt");
    expect(f.aufrufe[0].body.utid).toBe("U-STEAM-EUR");
  });

  it("Tango-Fehler (z.B. Guthaben des Kontos leer) → abgelehnt, Nutzer-Guthaben zurueck", async () => {
    vi.stubGlobal("fetch", zahlungsMock({ tango: () => ({ ok: false, status: 402,
      text: async () => JSON.stringify({ errors: [{ i18nKey: "insufficient_funds" }], message: "Insufficient funds" }) }) }));
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, "amazon", 10);
    expect(r.body.status).toBe("abgelehnt");
    expect((await guthaben(n.id)).frei).toBe(20000);
    expect((await protokoll(n))[0].details.fehler).toMatch(/tango: HTTP 402/);
  });

  it("fehlende UTID in der .env wirft sauber", async () => {
    await expect(tango.senden({ beleg_nr: "AZ-1", betrag_eur: 5 }, "a@b.de", undefined)).rejects.toThrow(/utid/);
    expect(new Dienstfehler("tango", 400, { message: "bad mail x@y.de" }).message).not.toContain("x@y.de");
  });
});

describe("Aufgabe 10 — Auszahlungsziele verschluesselt", () => {
  it("SELECT ziel zeigt nur Ciphertext, ziel_hash bleibt, Entschluesselung liefert das Ziel, Auszahlung klappt", async () => {
    const f = zahlungsMock(); vi.stubGlobal("fetch", f);
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    expect((await anfordern(n, "amazon", 10, "geheim@example.com")).body.status).toBe("ausgezahlt");

    const { rows: [z] } = await sql(`SELECT ziel, ziel_hash, encode(ziel, 'escape') AS roh FROM auszahlungen WHERE nutzer_id=$1`, [n.id]);
    expect(Buffer.isBuffer(z.ziel)).toBe(true);
    expect(z.roh).not.toContain("geheim@example.com");
    expect(z.ziel_hash).toMatch(/^[0-9a-f]{64}$/);

    const a = await auftrag(n);
    expect(await db.auszahlungZiel(a.id)).toBe("geheim@example.com");
    const { rows: [d] } = await sql(`SELECT pgp_sym_decrypt(ziel, $1) AS k FROM auszahlungen WHERE id=$2`, [process.env.ZIEL_SCHLUESSEL, a.id]);
    expect(d.k).toBe("geheim@example.com");
    await expect(sql(`SELECT pgp_sym_decrypt(ziel, 'falscher-schluessel') FROM auszahlungen WHERE id=$1`, [a.id])).rejects.toThrow();
    expect(f.aufrufe[0].body.recipient.email).toBe("geheim@example.com");   // Klartext nur beim Senden
  });

  it("Mehrfachkonto-Pruefung ueber ziel_hash funktioniert weiter", async () => {
    vi.stubGlobal("fetch", zahlungsMock());
    const a = await nutzerAnlegen({ telefon: true }), b = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(a.id, 20000); await guthabenSetzen(b.id, 20000);
    await anfordern(a, "amazon", 10, "gleich@example.com");
    const r = await anfordern(b, "amazon", 10, "gleich@example.com");
    expect(r.body.status).toBe("pruefung");                       // payout_geteilt (50) → manuelle Pruefung
    expect((await db.kennzahlenFuer(b.id)).kontenMitGleicherAuszahladresse).toBe(2);
    expect((await db.kennzahlenFuer(b.id, { ziel: "anders@example.com" })).kontenMitGleicherAuszahladresse).toBe(2);   // Historie bleibt
  });

  it("gesperrtes Auszahlungsziel: harte Sperre schon bei der Anfrage", async () => {
    vi.stubGlobal("fetch", zahlungsMock());
    await db.aufSperrlisteSetzen("auszahlziel", "boese@example.com", "Test");
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const r = await anfordern(n, "amazon", 10, "boese@example.com");
    expect(r.body.status).toBe("pruefung");
    expect((await db.kennzahlenFuer(n.id, { ziel: "boese@example.com" })).auszahladresseAufSperrliste).toBe(true);
    expect((await db.kennzahlenFuer(n.id, { ziel: "brav@example.com" })).auszahladresseAufSperrliste).toBe(false);
  });

  it("auszahlungAusfuehren aus 'pruefung' heraus (spaetere Admin-Freigabe) — einmalig", async () => {
    vi.stubGlobal("fetch", zahlungsMock());
    const n = await nutzerAnlegen({ telefon: true });
    await guthabenSetzen(n.id, 20000);
    const { rows: [a] } = await sql(`INSERT INTO auszahlungen (beleg_nr, nutzer_id, methode, ziel, ziel_hash, betrag_eur, status)
      VALUES ('AZ-777777',$1,'amazon',pgp_sym_encrypt('x@example.com',$2),'h',10,'pruefung') RETURNING *`, [n.id, process.env.ZIEL_SCHLUESSEL]);
    expect(await auszahlungAusfuehren(a)).toBe("ausgezahlt");
    expect(await auszahlungAusfuehren(a)).toBe("pruefung");      // schon erledigt: keine zweite Bestellung
    expect((await auftrag(n)).status).toBe("ausgezahlt");
  });
});
