/**
 * CoinCurb — Auszahlungsdienste
 * PayPal Payouts (Sandbox/Live) und Tango Card RaaS v2 (Gutscheine: Amazon, Steam).
 *
 * Jede senden()-Funktion bekommt den Auftrag aus `auszahlungen` und das entschluesselte Ziel
 * und liefert { status: "ausgezahlt" | "laeuft" | "abgelehnt", ref, grund }.
 * Netz- oder Dienstfehler werfen — server.js bucht dann zurueck und protokolliert.
 * Gutschein-Codes werden NIE gespeichert, nur die Bestellreferenz; Zustellung per Mail durch Tango.
 */

const zeit = () => AbortSignal.timeout(Number(process.env.ZAHLUNG_TIMEOUT_MS || 15000));
const basic = (a, b) => "Basic " + Buffer.from(`${a}:${b}`).toString("base64");

/** Antwort lesen, ohne dass Empfaengerdaten in Fehlermeldungen landen */
async function json(r) {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { roh: text.slice(0, 200) }; }
}
export class Dienstfehler extends Error {
  constructor(dienst, status, d) {
    super(`${dienst}: HTTP ${status} ${String(d?.name || d?.error || d?.errorMessage || d?.message || "").replace(/\S+@\S+/g, "[mail]").slice(0, 120)}`);
    this.dienst = dienst; this.status = status;
  }
}

/* ============================================================
   PayPal Payouts — developer.paypal.com/docs/api/payments.payouts-batch/v1
   ============================================================ */

let paypalToken = { wert: null, bis: 0 };

export const paypal = {
  basis: () => process.env.PAYPAL_UMGEBUNG === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",

  /** OAuth2 client_credentials, Token wird bis kurz vor Ablauf wiederverwendet */
  async zugang() {
    if (paypalToken.wert && Date.now() < paypalToken.bis) return paypalToken.wert;
    const r = await fetch(paypal.basis() + "/v1/oauth2/token", {
      method: "POST", signal: zeit(),
      headers: { Authorization: basic(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET),
                 "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const d = await json(r);
    if (!r.ok || !d.access_token) throw new Dienstfehler("paypal-token", r.status, d);
    paypalToken = { wert: d.access_token, bis: Date.now() + (Number(d.expires_in || 300) - 60) * 1000 };
    return d.access_token;
  },
  vergessen() { paypalToken = { wert: null, bis: 0 }; },

  /** Ein Auftrag = ein Batch mit einem Item; beleg_nr als Request-ID und Batch-ID macht Wiederholungen idempotent */
  async senden(auftrag, ziel) {
    const betrag = (Number(auftrag.betrag_eur) - Number(auftrag.gebuehr_eur || 0)).toFixed(2);
    const r = await fetch(paypal.basis() + "/v1/payments/payouts", {
      method: "POST", signal: zeit(),
      headers: { Authorization: "Bearer " + await paypal.zugang(), "Content-Type": "application/json",
                 "PayPal-Request-Id": auftrag.beleg_nr },
      body: JSON.stringify({
        sender_batch_header: { sender_batch_id: auftrag.beleg_nr, email_subject: "Deine CoinCurb-Auszahlung",
                               email_message: "Danke fuers Mitmachen bei CoinCurb!" },
        items: [{ recipient_type: "EMAIL", receiver: ziel, sender_item_id: auftrag.beleg_nr,
                  amount: { value: betrag, currency: "EUR" }, note: "CoinCurb Auszahlung " + auftrag.beleg_nr }],
      }),
    });
    const d = await json(r);
    if (!r.ok) throw new Dienstfehler("paypal", r.status, d);
    return paypal.deuten(d);
  },

  /** Batch nachschauen — Payouts laufen asynchron, meist wenige Sekunden bis Minuten */
  async status(auftrag) {
    const r = await fetch(paypal.basis() + "/v1/payments/payouts/" + encodeURIComponent(auftrag.anbieter_ref), {
      signal: zeit(), headers: { Authorization: "Bearer " + await paypal.zugang() },
    });
    const d = await json(r);
    if (!r.ok) throw new Dienstfehler("paypal-status", r.status, d);
    return paypal.deuten(d);
  },

  /** PayPal-Status → unserer. Item-Status ist genauer als der Batch-Status. */
  deuten(d) {
    const ref = d.batch_header?.payout_batch_id;
    const item = d.items?.[0]?.transaction_status;
    const batch = d.batch_header?.batch_status;
    if (item === "SUCCESS") return { status: "ausgezahlt", ref };
    if (["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"].includes(item))
      return { status: "abgelehnt", ref, grund: "paypal:" + item };
    if (["DENIED", "CANCELED"].includes(batch)) return { status: "abgelehnt", ref, grund: "paypal:" + batch };
    if (batch === "SUCCESS" && !item) return { status: "ausgezahlt", ref };
    return { status: "laeuft", ref };   // PENDING, PROCESSING, UNCLAIMED, ONHOLD → spaeter nachpruefen
  },
};

/* ============================================================
   Tango Card RaaS v2 — developers.tangocard.com/reference/createorder
   ============================================================ */

export const tango = {
  basis: () => process.env.TANGO_UMGEBUNG === "live" ? "https://api.tangocard.com/raas/v2" : "https://integration-api.tangocard.com/raas/v2",

  /** Gutschein bestellen; Tango schickt die Mail mit dem Code selbst (deliveryMethod EMAIL) */
  async senden(auftrag, ziel, utid) {
    if (!utid) throw new Error("tango: utid fehlt (TANGO_UTID_* in der .env)");
    const r = await fetch(tango.basis() + "/orders", {
      method: "POST", signal: zeit(),
      headers: { Authorization: basic(process.env.TANGO_PLATFORM, process.env.TANGO_KEY), "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIdentifier: process.env.TANGO_ACCOUNT,
        customerIdentifier: process.env.TANGO_CUSTOMER,
        utid,
        amount: Number((Number(auftrag.betrag_eur) - Number(auftrag.gebuehr_eur || 0)).toFixed(2)),
        deliveryMethod: "EMAIL",
        externalRefID: auftrag.beleg_nr,          // idempotent: gleiche Beleg-Nr = dieselbe Bestellung
        recipient: { email: ziel, firstName: "CoinCurb", lastName: "Nutzer" },
        emailSubject: "Dein Gutschein von CoinCurb",
        message: "Danke fuers Mitmachen bei CoinCurb! Beleg " + auftrag.beleg_nr,
      }),
    });
    const d = await json(r);
    if (!r.ok) throw new Dienstfehler("tango", r.status, d);
    // d.reward enthaelt den Code — wird bewusst nicht weitergegeben und nirgends gespeichert
    const ref = d.referenceOrderID;
    if (!ref) throw new Dienstfehler("tango", r.status, { name: "referenceOrderID fehlt" });
    if (d.status && !["COMPLETE", "PENDING", "PROCESSING"].includes(String(d.status).toUpperCase()))
      return { status: "abgelehnt", ref, grund: "tango:" + d.status };
    return { status: String(d.status).toUpperCase() === "COMPLETE" || !d.status ? "ausgezahlt" : "laeuft", ref };
  },
};
