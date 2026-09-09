/**
 * CoinCurb — Versand
 * Mail ueber Resend, SMS-Codes ueber Twilio Verify (Twilio erzeugt und prueft den Code selbst,
 * bei uns wird kein SMS-Code gespeichert). Zugangsdaten nur aus der .env.
 *
 * Ohne RESEND_KEY werden Mails nicht verschickt (Warnung im Log, ohne Inhalt).
 * Ohne Twilio-Konfiguration meldet sms.eingerichtet() false — die Routen antworten dann 503.
 * Empfaenger (Adressen, Nummern) tauchen nie in Fehlermeldungen oder Logs auf.
 */

const zeit = () => AbortSignal.timeout(Number(process.env.VERSAND_TIMEOUT_MS || 10000));
const basic = (a, b) => "Basic " + Buffer.from(`${a}:${b}`).toString("base64");
const ohneKontakt = (t) => String(t).replace(/\S+@\S+/g, "[mail]").replace(/\+?\d[\d\s\-()]{2,}\d/g, "[nummer]").slice(0, 160);

export class Versandfehler extends Error {
  constructor(dienst, status, d) {
    super(`${dienst}: HTTP ${status} ${ohneKontakt(d?.message || d?.name || d?.error || "")}`);
    this.dienst = dienst; this.status = status; this.code = d?.code;
  }
}
async function json(r) {
  const t = await r.text();
  try { return t ? JSON.parse(t) : {}; } catch { return { message: t.slice(0, 100) }; }
}

let gewarnt = false;

export const mail = {
  eingerichtet: () => !!process.env.RESEND_KEY,

  /** Liefert true, wenn verschickt; wirft Versandfehler bei Fehlern des Dienstes */
  async senden(an, betreff, text) {
    if (!mail.eingerichtet()) {
      if (!gewarnt) { console.warn("RESEND_KEY fehlt — Mails werden nicht verschickt."); gewarnt = true; }
      return false;
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: zeit(),
      headers: { Authorization: "Bearer " + process.env.RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_ABSENDER || "CoinCurb <no-reply@coincurb.app>", to: [an], subject: betreff, text }),
    });
    if (!r.ok) throw new Versandfehler("resend", r.status, await json(r));
    return true;
  },
};

export const sms = {
  eingerichtet: () => !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_VERIFY_SID),
  basis: () => `https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}`,
  kopf: () => ({ Authorization: basic(process.env.TWILIO_SID, process.env.TWILIO_TOKEN), "Content-Type": "application/x-www-form-urlencoded" }),

  /** Twilio schickt eine SMS mit einem 6-stelligen Code an die Nummer (E.164) */
  async codeSenden(nummer) {
    const r = await fetch(sms.basis() + "/Verifications", {
      method: "POST", signal: zeit(), headers: sms.kopf(),
      body: new URLSearchParams({ To: nummer, Channel: "sms", Locale: "de" }).toString(),
    });
    if (!r.ok) throw new Versandfehler("twilio", r.status, await json(r));
    return true;
  },

  /** true nur bei Status "approved"; falscher, abgelaufener oder unbekannter Code → false */
  async codePruefen(nummer, code) {
    const r = await fetch(sms.basis() + "/VerificationCheck", {
      method: "POST", signal: zeit(), headers: sms.kopf(),
      body: new URLSearchParams({ To: nummer, Code: code }).toString(),
    });
    const d = await json(r);
    if (r.status === 404) return false;                       // 20404: keine offene Pruefung (abgelaufen/erledigt)
    if (!r.ok) throw new Versandfehler("twilio", r.status, d);
    return d.status === "approved";
  },
};
