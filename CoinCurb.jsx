import React, { useState, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   KONFIGURATION
   API_BASE kommt aus der Build-Umgebung (Vite: VITE_API_BASE) oder aus
   window.COINCURB_API_BASE. Bleibt sie leer, laeuft die App mit Demo-Daten.
   Secrets gehoeren NIE hierher — nur ins Backend (.env). Welche Anbieter
   und Auszahlungswege aktiv sind, entscheidet das Backend (/api/walls,
   /api/auszahlung/wege).
   ============================================================ */

const API_BASE = (
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  (typeof window !== "undefined" && window.COINCURB_API_BASE) || ""
).replace(/\/$/, "");
const LIVE = API_BASE !== "";

/* Anzeige-Infos zu den Auszahlungswegen; ob ein Weg aktiv ist, sagt das Backend */
const PAYOUT_INFO = {
  paypal: { name: "PayPal",            dauer: "1–24 Std", feld: "PayPal-E-Mail-Adresse" },
  amazon: { name: "Amazon Gutschein",  dauer: "sofort",   feld: "E-Mail-Adresse für den Gutschein" },
  steam:  { name: "Steam Guthaben",    dauer: "sofort",   feld: "E-Mail-Adresse für den Gutschein" },
  bank:   { name: "SEPA-Überweisung",  dauer: "1–3 Tage", feld: "IBAN" },
  crypto: { name: "Bitcoin / USDT",    dauer: "1–2 Std",  feld: "Wallet-Adresse" },
};
const PAYOUTS_DEMO = [
  { id: "paypal", min: 5,  gebuehr: 0,    aktiv: false },
  { id: "amazon", min: 5,  gebuehr: 0,    aktiv: false },
  { id: "bank",   min: 20, gebuehr: 0.35, aktiv: false },
  { id: "steam",  min: 5,  gebuehr: 0,    aktiv: false },
  { id: "crypto", min: 10, gebuehr: 0.5,  aktiv: false },
];

const COINS_PRO_EURO = 1000;

/* ====================== Demo-Daten (nur ohne API_BASE) ====================== */

const DEMO_USER = {
  name: "Jonas", level: 7, xp: 2340, xpZiel: 3000, coins: 18420, coinsFrei: 15000, streak: 6,
  werbecode: "JONAS7", verifiziert: { mail: true, telefon: false, ausweis: false },
};
const DEMO_WALLS = [
  { id: "adgate",   name: "AdGate Media", typ: "Offerwall", url: "" },
  { id: "ayet",     name: "AyeT Studios", typ: "Offerwall", url: "" },
  { id: "torox",    name: "Torox",        typ: "Offerwall", url: "" },
  { id: "lootably", name: "Lootably",     typ: "Offerwall", url: "" },
  { id: "bitlabs",  name: "BitLabs",      typ: "Umfragen",  url: "" },
  { id: "cpx",      name: "CPX Research", typ: "Umfragen",  url: "" },
];
const DEMO_ANGEBOTE = [
  { id: 1, titel: "Coin Master — Dorf 12 erreichen", anbieter: "AdGate Media", coins: 14200, minuten: 90, typ: "Spiel", schwer: 3, quote: 71 },
  { id: 2, titel: "Umfrage: Einkaufsgewohnheiten", anbieter: "CPX Research", coins: 1350, minuten: 12, typ: "Umfrage", schwer: 1, quote: 88 },
  { id: 3, titel: "Trading-App — Konto verifizieren", anbieter: "Torox", coins: 32500, minuten: 25, typ: "Anmeldung", schwer: 2, quote: 64 },
  { id: 4, titel: "Match Blast — Level 40", anbieter: "AyeT Studios", coins: 8900, minuten: 60, typ: "Spiel", schwer: 2, quote: 76 },
  { id: 5, titel: "Streaming 7 Tage testen", anbieter: "Lootably", coins: 6400, minuten: 8, typ: "Testphase", schwer: 1, quote: 82 },
  { id: 6, titel: "Kurzumfrage: Mobilität", anbieter: "BitLabs", coins: 620, minuten: 5, typ: "Umfrage", schwer: 1, quote: 91 },
];
const DEMO_VERLAUF = {
  buchungen: [
    { id: 8842, titel: "Match Blast — Level 20", art: "aufgabe", coins: 3100, status: "frei", erstellt: new Date(Date.now() - 2 * 36e5).toISOString() },
    { id: 8839, titel: "Umfrage: Ernährung", art: "aufgabe", coins: 940, status: "haltefrist", frei_ab: new Date(Date.now() + 68 * 36e5).toISOString(), erstellt: new Date(Date.now() - 4 * 36e5).toISOString() },
    { id: 8830, titel: "Auszahlung paypal", art: "auszahlung", coins: -5000, status: "frei", erstellt: new Date(Date.now() - 864e5).toISOString() },
    { id: 8811, titel: "Willkommensbonus", art: "bonus", coins: 500, status: "frei", erstellt: new Date(Date.now() - 864e5).toISOString() },
    { id: 8790, titel: "Fitness-App Anmeldung", art: "aufgabe", coins: 2400, status: "storniert", erstellt: new Date(Date.now() - 3 * 864e5).toISOString() },
  ],
  auszahlungen: [{ beleg_nr: "AZ-118203", methode: "paypal", betrag_eur: 5, status: "ausgezahlt", erstellt: new Date(Date.now() - 864e5).toISOString() }],
};
const DEMO_RANGLISTE = [
  { platz: 1, name: "kevin_ffm", coins: 412000 }, { platz: 2, name: "sanni", coins: 388400 },
  { platz: 3, name: "m4rc0", coins: 351200 }, { platz: 4, name: "Jonas", coins: 298650, ich: true },
  { platz: 5, name: "lea.k", coins: 244100 },
];
const DEMO_RISIKO = { punkte: 18, stufe: "normal", signale: ["Gerät zum ersten Mal gesehen"] };

/* ====================== Helfer ====================== */

const eur = (coins) => (Number(coins) / COINS_PRO_EURO).toFixed(2).replace(".", ",") + " €";
const eurBetrag = (b) => Number(b).toFixed(2).replace(".", ",") + " €";
const zahl = (n) => Number(n).toLocaleString("de-DE");
const wann = (iso) => {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (d < 1) return "gerade eben";
  if (d < 24) return `vor ${Math.floor(d)} Std`;
  if (d < 48) return "gestern";
  return `vor ${Math.floor(d / 24)} Tagen`;
};
const bis = (iso) => {
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 36e5);
  return h <= 0 ? "gleich" : h < 48 ? `in ${h} Std` : `in ${Math.ceil(h / 24)} Tagen`;
};

/* ====================== API-Schicht ====================== */

const speicher = {
  get: (k) => { try { return localStorage.getItem("cc." + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem("cc." + k) : localStorage.setItem("cc." + k, v); } catch { /* privat/blockiert */ } },
};

/** Geräte-Kennung: im Browser eine zufällige UUID, in der App kommt sie aus dem nativen Kontext (Aufgabe 15) */
function geraetId() {
  let id = speicher.get("geraet");
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    speicher.set("geraet", id);
  }
  return id;
}
const plattform = () => (typeof window !== "undefined" && window.COINCURB_PLATTFORM) || "web";

class ApiFehler extends Error {
  constructor(text, status, daten) { super(text); this.status = status; this.daten = daten || {}; }
}

let tokens = { zugang: speicher.get("zugang"), refresh: speicher.get("refresh") };
let beimAbmelden = () => {};
function tokensSetzen(t) {
  tokens = { zugang: t?.zugang || null, refresh: t?.refresh || null };
  speicher.set("zugang", tokens.zugang);
  speicher.set("refresh", tokens.refresh);
}
function lokalAbmelden() { tokensSetzen(null); beimAbmelden(); }

let erneuerung = null;
/** Refresh-Token einloesen; laeuft nur einmal gleichzeitig */
function erneuern() {
  if (!erneuerung) {
    erneuerung = (async () => {
      try {
        const r = await fetch(API_BASE + "/api/token", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Device-Id": geraetId(), "X-Platform": plattform() },
          body: JSON.stringify({ refresh: tokens.refresh }),
        });
        if (!r.ok) return false;
        tokensSetzen(await r.json());
        return true;
      } catch { return false; } finally { erneuerung = null; }
    })();
  }
  return erneuerung;
}

/** Ein Aufruf ans Backend. Bei 401 einmal Token erneuern und wiederholen, sonst abmelden. */
async function api(pfad, { method = "GET", body, auth = true, _wiederholt = false } = {}) {
  const headers = { "Content-Type": "application/json", "X-Device-Id": geraetId(), "X-Platform": plattform() };
  if (auth && tokens.zugang) headers.Authorization = "Bearer " + tokens.zugang;
  let r;
  try {
    r = await fetch(API_BASE + pfad, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFehler("Keine Verbindung. Prüf dein Netz und versuch es noch einmal.", 0);
  }
  if (r.status === 401 && auth) {
    if (!_wiederholt && tokens.refresh && await erneuern()) return api(pfad, { method, body, auth, _wiederholt: true });
    lokalAbmelden();
    throw new ApiFehler("Bitte melde dich neu an.", 401);
  }
  const daten = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFehler(daten.fehler || "Da ist etwas schiefgelaufen. Bitte versuch es später noch einmal.", r.status, daten);
  return daten;
}

/* ====================== App ====================== */

export default function App() {
  const [tab, setTab] = useState("verdienen");
  const [angemeldet, setAngemeldet] = useState(!LIVE || !!tokens.zugang);
  const [user, setUser] = useState(LIVE ? null : DEMO_USER);
  const [meldung, setMeldung] = useState(null);
  const [beleg, setBeleg] = useState(null);

  const ladeUser = useCallback(async () => {
    if (!LIVE) return;
    try { setUser(await api("/api/ich")); }
    catch (e) { if (e.status !== 401) setMeldung(e.message); }
  }, []);

  useEffect(() => { beimAbmelden = () => { setAngemeldet(false); setUser(null); }; return () => { beimAbmelden = () => {}; }; }, []);
  useEffect(() => { if (LIVE && angemeldet) ladeUser(); }, [angemeldet, ladeUser]);

  /* Link aus der Bestätigungsmail: APP_URL/bestaetigen?c=... */
  useEffect(() => {
    if (!LIVE || typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const c = u.searchParams.get("c");
    if (!c || !u.pathname.startsWith("/bestaetigen")) return;
    api("/api/email/bestaetigen?c=" + encodeURIComponent(c), { auth: false })
      .then(() => { setMeldung("E-Mail bestätigt. 500 Coins Willkommensbonus sind auf deinem Konto."); ladeUser(); })
      .catch((e) => setMeldung(e.message))
      .finally(() => window.history.replaceState({}, "", "/"));
  }, [ladeUser]);

  if (LIVE && !angemeldet) {
    return (
      <div className="cc-root"><Styles />
        <div className="cc-phone"><Anmeldung onFertig={() => setAngemeldet(true)} /></div>
        {meldung && <Meldung text={meldung} onClose={() => setMeldung(null)} />}
      </div>
    );
  }
  if (LIVE && !user) {
    return <div className="cc-root"><Styles /><div className="cc-phone"><div className="cc-laden">Lädt …</div></div>
      {meldung && <Meldung text={meldung} onClose={() => setMeldung(null)} />}</div>;
  }

  return (
    <div className="cc-root">
      <Styles />
      <div className="cc-phone">
        <Kopf user={user} />
        <main className="cc-main">
          {tab === "verdienen" && <Verdienen melde={setMeldung} />}
          {tab === "bonus" && <Bonus user={user} melde={setMeldung} />}
          {tab === "rang" && <Rangliste />}
          {tab === "auszahlen" && <Auszahlen user={user} onBeleg={setBeleg} onAktualisieren={ladeUser} />}
          {tab === "konto" && <Konto user={user} onAktualisieren={ladeUser} melde={setMeldung} />}
        </main>
        <Navigation tab={tab} setTab={setTab} />
      </div>
      {beleg && <BelegOverlay beleg={beleg} onClose={() => setBeleg(null)} />}
      {meldung && <Meldung text={meldung} onClose={() => setMeldung(null)} />}
    </div>
  );
}

function Meldung({ text, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 7000); return () => clearTimeout(t); }, [text, onClose]);
  return <div className="cc-meldung" role="status"><span>{text}</span><button onClick={onClose} aria-label="Schließen">×</button></div>;
}

/* ====================== Anmeldung ====================== */

function Anmeldung({ onFertig }) {
  const [modus, setModus] = useState("anmelden");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [name, setName] = useState("");
  const [werbecode, setWerbecode] = useState("");
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e) {
    e.preventDefault();
    setFehler(null); setLaeuft(true);
    try {
      const pfad = modus === "anmelden" ? "/api/anmelden" : "/api/registrieren";
      const body = modus === "anmelden" ? { email, passwort } : { email, passwort, anzeigename: name || undefined, werbecode: werbecode || undefined };
      const d = await api(pfad, { method: "POST", body, auth: false });
      tokensSetzen(d);
      onFertig(d);
    } catch (e2) { setFehler(e2.message); }
    finally { setLaeuft(false); }
  }

  return (
    <form className="cc-login" onSubmit={absenden}>
      <span className="cc-login-marke">COINCURB</span>
      <h1>{modus === "anmelden" ? "Willkommen zurück." : "Konto anlegen."}</h1>
      <p className="cc-login-text">
        {modus === "anmelden" ? "Melde dich an, um weiterzuverdienen." : "Aufgaben erledigen, Coins sammeln, auszahlen. 1.000 Coins = 1,00 €. Ab 16 Jahren."}
      </p>
      {fehler && <div className="cc-fehler" role="alert">{fehler}</div>}
      <label className="cc-label" htmlFor="cc-email">E-Mail</label>
      <input id="cc-email" className="cc-input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="cc-label" htmlFor="cc-pass">Passwort {modus === "registrieren" && "(mindestens 10 Zeichen)"}</label>
      <input id="cc-pass" className="cc-input" type="password" autoComplete={modus === "anmelden" ? "current-password" : "new-password"}
        minLength={modus === "registrieren" ? 10 : undefined} required value={passwort} onChange={(e) => setPasswort(e.target.value)} />
      {modus === "registrieren" && (
        <>
          <label className="cc-label" htmlFor="cc-name">Anzeigename (optional)</label>
          <input id="cc-name" className="cc-input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="cc-label" htmlFor="cc-code">Werbecode (optional)</label>
          <input id="cc-code" className="cc-input" maxLength={6} value={werbecode} onChange={(e) => setWerbecode(e.target.value.toUpperCase())} />
        </>
      )}
      <button className="cc-knopf" type="submit" disabled={laeuft}>
        {laeuft ? "Einen Moment …" : modus === "anmelden" ? "Anmelden" : "Konto anlegen"}
      </button>
      <button type="button" className="cc-login-wechsel" onClick={() => { setModus(modus === "anmelden" ? "registrieren" : "anmelden"); setFehler(null); }}>
        {modus === "anmelden" ? "Noch kein Konto? Jetzt registrieren" : "Schon dabei? Zur Anmeldung"}
      </button>
    </form>
  );
}

/* ====================== Kopf ====================== */

function Kopf({ user }) {
  const fortschritt = user.xpZiel ? Math.min(100, (user.xp / user.xpZiel) * 100) : null;
  return (
    <header className="cc-kopf">
      <div className="cc-kopf-zeile">
        <div className="cc-avatar">{(user.name || "?")[0].toUpperCase()}</div>
        <div className="cc-kopf-text">
          <span className="cc-eyebrow">{user.level ? `Stufe ${user.level}` : "Mitglied"}</span>
          <strong className="cc-name">{user.name}</strong>
        </div>
        {user.streak != null && (
          <div className="cc-streak" title="Tage in Folge aktiv">
            <span className="cc-streak-zahl">{user.streak}</span>
            <span className="cc-streak-label">Tage</span>
          </div>
        )}
      </div>

      <div className="cc-balance">
        <div>
          <span className="cc-eyebrow">Guthaben</span>
          <div className="cc-balance-eur" data-test="guthaben">{eur(user.coins)}</div>
          <div className="cc-balance-coins">{zahl(user.coins)} Coins · {eur(user.coinsFrei ?? 0)} verfügbar</div>
        </div>
        <div className="cc-balance-rate">
          <span>1.000 Coins</span>
          <span className="cc-gleich">=</span>
          <span>1,00 €</span>
        </div>
      </div>

      {fortschritt != null && (
        <div className="cc-xp">
          <div className="cc-xp-bar"><i style={{ width: fortschritt + "%" }} /></div>
          <span>Noch {zahl(user.xpZiel - user.xp)} XP bis Stufe {user.level + 1}</span>
        </div>
      )}
    </header>
  );
}

/* ====================== Verdienen ====================== */

function Verdienen({ melde }) {
  const [filter, setFilter] = useState("Alle");
  const [walls, setWalls] = useState(LIVE ? null : DEMO_WALLS);
  const typen = ["Alle", "Spiel", "Umfrage", "Anmeldung", "Testphase"];

  useEffect(() => {
    if (!LIVE) return;
    api("/api/walls").then(setWalls).catch((e) => { setWalls([]); melde(e.message); });
  }, [melde]);

  const angebote = useMemo(
    () => (filter === "Alle" ? DEMO_ANGEBOTE : DEMO_ANGEBOTE.filter((a) => a.typ === filter)),
    [filter]
  );

  async function oeffnen(w) {
    if (!w.url) return;
    const fenster = window.open("", "_blank");            // vor dem await, sonst blockt der Popup-Schutz
    try { await api("/api/aufgabe/start", { method: "POST", body: { partner: w.id, angebot: "wall" } }); } catch { /* nur Statistik */ }
    if (fenster) fenster.location = w.url; else window.location.href = w.url;
  }

  const verbunden = (walls || []).filter((w) => w.url);

  return (
    <>
      {walls && verbunden.length === 0 && (
        <Hinweis
          titel="Noch keine Anbieter verbunden"
          text={LIVE
            ? "Sobald im Backend die öffentlichen IDs der Partner eingetragen sind, erscheinen hier die Angebotswände."
            : "Ohne API_BASE läuft die App mit Beispieldaten. Trage im Backend die Partner ein und setze VITE_API_BASE."}
        />
      )}

      <Abschnitt titel="Anbieter" zusatz={walls ? `${verbunden.length || walls.length} Wände` : "lädt …"}>
        <div className="cc-wall-reihe">
          {(walls || []).map((w) => (
            <button key={w.id} className={"cc-wall" + (w.url ? "" : " cc-wall--aus")} onClick={() => oeffnen(w)} data-test={"wall-" + w.id}>
              <span className="cc-wall-name">{w.name}</span>
              <span className="cc-wall-typ">{w.typ}</span>
              {!w.url && <span className="cc-wall-status">nicht verbunden</span>}
            </button>
          ))}
        </div>
      </Abschnitt>

      {LIVE ? (
        <Abschnitt titel="So funktioniert es">
          <div className="cc-flaeche">
            <p className="cc-flaeche-text">
              Öffne eine Wand, such dir dort eine Aufgabe aus und erledige sie. Der Anbieter meldet den Abschluss an uns,
              die Coins erscheinen im Verlauf unter „Auszahlen“.
            </p>
            <p className="cc-klein">
              Neue Coins sind 72 Stunden in der Haltefrist, danach kannst du sie auszahlen. Zieht der Anbieter eine Buchung zurück,
              wird sie in dieser Zeit wieder abgezogen.
            </p>
          </div>
        </Abschnitt>
      ) : (
        <Abschnitt titel="Aufgaben">
          <div className="cc-filter">
            {typen.map((t) => (
              <button key={t} onClick={() => setFilter(t)} className={"cc-chip" + (filter === t ? " cc-chip--an" : "")}>{t}</button>
            ))}
          </div>
          <div className="cc-liste">
            {angebote.map((a) => <AngebotKarte key={a.id} a={a} />)}
          </div>
        </Abschnitt>
      )}
    </>
  );
}

function AngebotKarte({ a }) {
  return (
    <article className="cc-karte">
      <div className="cc-karte-kerbe" aria-hidden="true" />
      <div className="cc-karte-inhalt">
        <div className="cc-karte-meta">
          <span className="cc-tag">{a.typ}</span>
          <span className="cc-anbieter">{a.anbieter}</span>
        </div>
        <h3 className="cc-karte-titel">{a.titel}</h3>
        <div className="cc-karte-fuss">
          <span>{a.minuten} Min</span>
          <span className="cc-punkt">·</span>
          <span>{a.quote}% werden gutgeschrieben</span>
          <span className="cc-punkt">·</span>
          <span>{"▮".repeat(a.schwer)}{"▯".repeat(3 - a.schwer)}</span>
        </div>
      </div>
      <div className="cc-karte-wert">
        <strong>{eur(a.coins)}</strong>
        <span>{zahl(a.coins)}</span>
        <button className="cc-start">Starten</button>
      </div>
    </article>
  );
}

/* ====================== Bonus ====================== */

function Bonus({ user, melde }) {
  const [geholt, setGeholt] = useState(false);
  const tage = [250, 300, 400, 500, 700, 1000, 2500];
  const streak = user.streak ?? 0;

  function kopieren() {
    const code = user.werbecode || "";
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => melde("Code kopiert: " + code)).catch(() => melde("Dein Code: " + code));
    else melde("Dein Code: " + code);
  }

  return (
    <>
      <Abschnitt titel="Tägliche Belohnung" zusatz={LIVE ? "bald" : `Tag ${streak} von 7`}>
        <div className="cc-tage">
          {tage.map((c, i) => {
            const erledigt = !LIVE && i < streak;
            const heute = !LIVE && i === streak;
            return (
              <div key={i} className={"cc-tag-box" + (erledigt ? " cc-tag-box--ok" : "") + (heute ? " cc-tag-box--heute" : "")}>
                <span className="cc-tag-nr">{i + 1}</span>
                <span className="cc-tag-coins">{c}</span>
              </div>
            );
          })}
        </div>
        <button className="cc-knopf" disabled={LIVE || geholt} onClick={() => setGeholt(true)}>
          {LIVE ? "Startet in Kürze" : geholt ? "Für heute abgeholt" : `${tage[streak]} Coins abholen`}
        </button>
        <p className="cc-klein">Verpasst du einen Tag, fängt die Serie wieder bei Tag 1 an.</p>
      </Abschnitt>

      <Abschnitt titel="Freunde einladen">
        <div className="cc-flaeche">
          <p className="cc-flaeche-text">
            Du bekommst dauerhaft <strong>10 % von allem</strong>, was deine Eingeladenen verdienen — ohne dass ihnen etwas abgezogen wird.
          </p>
          <div className="cc-code">
            <span data-test="werbecode">{user.werbecode}</span>
            <button className="cc-knopf cc-knopf--klein" onClick={kopieren}>Kopieren</button>
          </div>
          <p className="cc-klein">
            Einladungen zählen erst, wenn der Freund 2,00 € selbst verdient hat. Gleiches Gerät oder gleiches Netzwerk zählt nicht.
          </p>
        </div>
      </Abschnitt>
    </>
  );
}

/* ====================== Rangliste ====================== */

function Rangliste() {
  if (LIVE) {
    return (
      <Abschnitt titel="Rangliste" zusatz="bald">
        <div className="cc-flaeche"><div className="cc-leer">Die Wochen-Rangliste startet, sobald genug Leute dabei sind. Bis dahin zählt jede Aufgabe schon.</div></div>
      </Abschnitt>
    );
  }
  return (
    <Abschnitt titel="Rangliste" zusatz="Diese Woche">
      <div className="cc-rang">
        {DEMO_RANGLISTE.map((r) => (
          <div key={r.platz} className={"cc-rang-zeile" + (r.ich ? " cc-rang-zeile--ich" : "")}>
            <span className="cc-rang-platz">{String(r.platz).padStart(2, "0")}</span>
            <span className="cc-rang-name">{r.name}</span>
            <span className="cc-rang-coins">{zahl(r.coins)}</span>
          </div>
        ))}
      </div>
      <p className="cc-klein">
        Die ersten drei bekommen am Sonntag um 23:59 Uhr 50 €, 25 € und 10 €. Gesperrte Konten fallen aus der Wertung.
      </p>
    </Abschnitt>
  );
}

/* ====================== Auszahlen ====================== */

function Auszahlen({ user, onBeleg, onAktualisieren }) {
  const [wege, setWege] = useState(LIVE ? null : PAYOUTS_DEMO);
  const [verlauf, setVerlauf] = useState(LIVE ? null : DEMO_VERLAUF);
  const [gewaehlt, setGewaehlt] = useState(null);
  const [ziel, setZiel] = useState("");
  const [betrag, setBetrag] = useState("");
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const freiEur = Number(user.coinsFrei ?? user.coins) / COINS_PRO_EURO;

  const ladeVerlauf = useCallback(() => { if (LIVE) api("/api/verlauf").then(setVerlauf).catch(() => setVerlauf({ buchungen: [], auszahlungen: [] })); }, []);
  useEffect(() => {
    if (!LIVE) return;
    api("/api/auszahlung/wege").then((w) => setWege(w.map((x) => ({ ...x, aktiv: true })))).catch(() => setWege([]));
    ladeVerlauf();
  }, [ladeVerlauf]);

  const liste = useMemo(() => {
    const aktive = (wege || []).filter((w) => w.aktiv);
    const basis = aktive.length ? aktive : PAYOUTS_DEMO;
    return basis.map((w) => ({ ...w, ...(PAYOUT_INFO[w.id] || { name: w.id, dauer: "", feld: "Ziel" }) }));
  }, [wege]);
  const aktiv = liste.filter((m) => m.aktiv);
  const methode = liste.find((m) => m.id === gewaehlt);
  const betragZahl = Math.round(Number(String(betrag).replace(",", ".")) * 100) / 100;
  const genug = methode ? freiEur >= methode.min : false;
  const betragOk = methode && Number.isFinite(betragZahl) && betragZahl >= methode.min && betragZahl <= freiEur && betragZahl <= 50;

  function waehlen(m) { setGewaehlt(m.id); setBetrag(String(Math.min(m.min, Math.max(m.min, Math.floor(freiEur * 100) / 100))).replace(".", ",")); setFehler(null); }

  async function anfordern() {
    if (!methode) return;
    setFehler(null);
    if (!LIVE) {
      onBeleg({ id: "AZ-" + Math.floor(100000 + Math.random() * 899999), methode: methode.name, ziel, betrag: betragZahl - methode.gebuehr, status: DEMO_RISIKO.punkte >= 30 ? "pruefung" : "laeuft" });
      return;
    }
    setLaeuft(true);
    try {
      const d = await api("/api/auszahlung", { method: "POST", body: { methode: methode.id, ziel: ziel.trim(), betrag: betragZahl } });
      onBeleg({ id: d.belegId, methode: methode.name, ziel: ziel.trim(), betrag: betragZahl - methode.gebuehr, status: d.status, hinweis: d.hinweis });
      setZiel(""); setGewaehlt(null);
      onAktualisieren(); ladeVerlauf();
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  }

  return (
    <>
      {wege && aktiv.length === 0 && (
        <Hinweis
          titel="Noch keine Auszahlungsart freigeschaltet"
          text={LIVE ? "Sobald im Backend ein Weg über AUSZAHLUNG_AKTIV freigeschaltet ist, kannst du hier auszahlen."
                     : "Setze im Backend AUSZAHLUNG_AKTIV und hinterlege die Zugangsdaten des Anbieters."}
        />
      )}

      <Abschnitt titel="Auszahlen" zusatz={eurBetrag(freiEur) + " verfügbar"}>
        <div className="cc-payout-gitter">
          {liste.map((m) => {
            const reicht = freiEur >= m.min;
            return (
              <button key={m.id} onClick={() => waehlen(m)} data-test={"weg-" + m.id}
                className={"cc-payout" + (gewaehlt === m.id ? " cc-payout--an" : "") + (m.aktiv ? "" : " cc-payout--aus")}>
                <span className="cc-payout-name">{m.name}</span>
                <span className="cc-payout-min">ab {eurBetrag(m.min)}</span>
                <span className={"cc-payout-fuss" + (reicht ? "" : " cc-payout-fuss--rot")}>
                  {m.aktiv ? (reicht ? m.dauer : "Guthaben reicht nicht") : "nicht eingerichtet"}
                </span>
              </button>
            );
          })}
        </div>

        {methode && (
          <div className="cc-flaeche">
            {fehler && <div className="cc-fehler" role="alert">{fehler}</div>}
            <label className="cc-label" htmlFor="cc-ziel">{methode.feld}</label>
            <input id="cc-ziel" className="cc-input" value={ziel} onChange={(e) => setZiel(e.target.value)} placeholder={methode.feld} data-test="ziel" />
            <label className="cc-label" htmlFor="cc-betrag">Betrag (max. 50 € pro Tag)</label>
            <div className="cc-betrag-eingabe">
              <input id="cc-betrag" className="cc-input" inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} data-test="betrag" />
              <span>€</span>
            </div>
            <div className="cc-rechnung">
              <div><span>Betrag</span><span>{Number.isFinite(betragZahl) ? eurBetrag(betragZahl) : "–"}</span></div>
              <div><span>Gebühr</span><span>{methode.gebuehr ? "-" + eurBetrag(methode.gebuehr) : "keine"}</span></div>
              <div className="cc-rechnung-summe">
                <span>Du bekommst</span>
                <span>{Number.isFinite(betragZahl) ? eurBetrag(Math.max(0, betragZahl - methode.gebuehr)) : "–"}</span>
              </div>
            </div>
            <button className="cc-knopf" data-test="anfordern" disabled={!genug || !betragOk || !ziel.trim() || !methode.aktiv || laeuft} onClick={anfordern}>
              {laeuft ? "Wird angefordert …" : "Auszahlung anfordern"}
            </button>
            <p className="cc-klein">
              Erste Auszahlung erst nach bestätigter Telefonnummer. Neu verdiente Coins sind 72 Stunden gesperrt,
              damit stornierte Buchungen der Partner noch abgezogen werden können.
            </p>
          </div>
        )}
      </Abschnitt>

      <Abschnitt titel="Verlauf">
        <div className="cc-verlauf" data-test="verlauf">
          {!verlauf && <div className="cc-leer">Lädt …</div>}
          {verlauf && verlauf.buchungen.length === 0 && verlauf.auszahlungen.length === 0 && (
            <div className="cc-leer">Noch nichts passiert. Erledige deine erste Aufgabe — die Gutschrift erscheint hier.</div>
          )}
          {verlauf && verlauf.auszahlungen.map((a) => (
            <div key={a.beleg_nr} className="cc-verlauf-zeile">
              <div>
                <strong>Auszahlung {PAYOUT_INFO[a.methode]?.name || a.methode}</strong>
                <span className="cc-verlauf-meta">{a.beleg_nr} · {wann(a.erstellt)}</span>
              </div>
              <div className="cc-verlauf-rechts">
                <span className="cc-betrag cc-betrag--ab">{eurBetrag(a.betrag_eur)}</span>
                <StatusPunkt status={a.status} />
              </div>
            </div>
          ))}
          {verlauf && verlauf.buchungen.map((b) => (
            <div key={b.id} className="cc-verlauf-zeile">
              <div>
                <strong>{b.titel || (b.art === "aufgabe" ? "Aufgabe" : b.art)}</strong>
                <span className="cc-verlauf-meta">
                  #{b.id} · {wann(b.erstellt)}
                  {b.status === "haltefrist" && b.frei_ab ? " · frei " + bis(b.frei_ab) : ""}
                  {b.status === "storniert" ? " · Partner hat die Buchung zurückgezogen" : ""}
                </span>
              </div>
              <div className="cc-verlauf-rechts">
                <span className={"cc-betrag" + (Number(b.coins) < 0 ? " cc-betrag--ab" : "")}>
                  {Number(b.coins) > 0 ? "+" : ""}{zahl(b.coins)}
                </span>
                <StatusPunkt status={b.status} />
              </div>
            </div>
          ))}
        </div>
      </Abschnitt>
    </>
  );
}

const STATUS_TEXT = {
  frei: ["gutgeschrieben", "ok"], haltefrist: ["in Haltefrist", "warte"], zurueckgehalten: ["in Prüfung", "warte"], storniert: ["storniert", "weg"],
  ausgezahlt: ["ausgezahlt", "ok"], laeuft: ["läuft", "warte"], pruefung: ["in Prüfung", "warte"], abgelehnt: ["nicht geklappt", "weg"],
};
function StatusPunkt({ status }) {
  const [text, klasse] = STATUS_TEXT[status] || [status, "warte"];
  return <span className={"cc-status cc-status--" + klasse}>{text}</span>;
}

/* Signatur der App: der Auszahlungsbeleg */
function BelegOverlay({ beleg, onClose }) {
  const titel = { ausgezahlt: "Ausgezahlt", laeuft: "Angefordert", pruefung: "In Prüfung", abgelehnt: "Nicht geklappt" }[beleg.status] || "Angefordert";
  const text = beleg.hinweis || {
    ausgezahlt: "Erledigt. Schau in dein Postfach beziehungsweise dein Konto.",
    laeuft: "Der Auftrag läuft. Du bekommst eine Nachricht, sobald das Geld raus ist.",
    pruefung: "Ein Mitarbeiter schaut sich das Konto an. Das dauert in der Regel bis zu 24 Stunden.",
    abgelehnt: "Die Auszahlung hat nicht geklappt. Dein Guthaben ist wieder da.",
  }[beleg.status];
  return (
    <div className="cc-overlay" onClick={onClose}>
      <div className="cc-beleg" onClick={(e) => e.stopPropagation()} data-test="beleg">
        <div className="cc-beleg-kante cc-beleg-kante--oben" />
        <div className="cc-beleg-inhalt">
          <span className="cc-beleg-marke">COINCURB</span>
          <h2 className="cc-beleg-titel">{titel}</h2>
          <dl className="cc-beleg-daten">
            <div><dt>Beleg</dt><dd data-test="beleg-nr">{beleg.id}</dd></div>
            <div><dt>Weg</dt><dd>{beleg.methode}</dd></div>
            <div><dt>Ziel</dt><dd>{beleg.ziel}</dd></div>
            <div><dt>Betrag</dt><dd>{eurBetrag(beleg.betrag)}</dd></div>
          </dl>
          <p className="cc-beleg-text">{text}</p>
          <button className="cc-knopf" onClick={onClose}>Schließen</button>
        </div>
        <div className="cc-beleg-kante cc-beleg-kante--unten" />
      </div>
    </div>
  );
}

/* ====================== Konto & Sicherheit ====================== */

function Konto({ user, onAktualisieren, melde }) {
  const [risiko, setRisiko] = useState(LIVE ? null : DEMO_RISIKO);
  const [dialog, setDialog] = useState(null);   // "telefon" | "loeschen"

  useEffect(() => { if (LIVE) api("/api/security").then(setRisiko).catch(() => setRisiko({ punkte: 0, stufe: "unbekannt", signale: [] })); }, []);

  async function mailErneut() {
    if (!LIVE) return melde("Im Demo-Modus gibt es keine Mails.");
    try { await api("/api/email/erneut", { method: "POST" }); melde("Wir haben dir die Bestätigungsmail noch einmal geschickt."); }
    catch (e) { melde(e.message); }
  }
  async function abmelden() {
    if (LIVE) { try { await api("/api/abmelden", { method: "POST" }); } catch { /* egal, lokal wird ohnehin abgemeldet */ } }
    lokalAbmelden();
  }

  const r = risiko;
  return (
    <>
      <Abschnitt titel="Verifizierung">
        <div className="cc-flaeche">
          <SchrittZeile fertig={user.verifiziert.mail} text="E-Mail bestätigt" aktion={mailErneut} aktionText="Mail erneut" />
          <SchrittZeile fertig={user.verifiziert.telefon} text="Telefonnummer bestätigt — nötig für die erste Auszahlung" aktion={() => setDialog("telefon")} />
          <SchrittZeile fertig={user.verifiziert.ausweis} text="Ausweis — nötig ab 100 € Auszahlung im Monat" aktion={() => melde("Die Ausweisprüfung schalten wir frei, sobald du sie brauchst. Melde dich dann kurz beim Support.")} />
        </div>
      </Abschnitt>

      <Abschnitt titel="Kontosicherheit" zusatz={r ? r.stufe : "lädt …"}>
        <div className="cc-flaeche">
          {r && (
            <>
              <div className="cc-risiko">
                <div className="cc-risiko-bar">
                  <i style={{ width: r.punkte + "%" }} className={r.punkte < 30 ? "gruen" : r.punkte < 60 ? "gelb" : "rot"} />
                </div>
                <span className="cc-klein">
                  Wir prüfen jedes Konto automatisch. Unter 30 Punkten läuft alles ohne Wartezeit durch. Aktuell: {r.punkte} Punkte.
                </span>
              </div>
              {r.signale.length === 0 && (
                <div className="cc-signal"><span className="cc-signal-punkt ok" /><span className="cc-signal-label">Keine Auffälligkeiten</span></div>
              )}
              {r.signale.map((s, i) => (
                <div key={i} className="cc-signal">
                  <span className="cc-signal-punkt offen" />
                  <span className="cc-signal-label">{typeof s === "string" ? s : s.label}</span>
                  {typeof s !== "string" && <span className="cc-signal-wert">{s.wert}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      </Abschnitt>

      <Abschnitt titel="Konto">
        <div className="cc-flaeche">
          <p className="cc-flaeche-text">Werbecode <strong>{user.werbecode}</strong></p>
          <button className="cc-knopf cc-knopf--leise" onClick={abmelden}>Abmelden</button>
          <button className="cc-knopf cc-knopf--leise" onClick={() => setDialog("loeschen")} data-test="konto-loeschen">Konto löschen</button>
          <p className="cc-klein">Beim Löschen werden deine Daten anonymisiert. Offenes Guthaben verfällt. Buchungsdaten müssen wir aus steuerlichen Gründen 10 Jahre aufbewahren.</p>
        </div>
      </Abschnitt>

      {dialog === "telefon" && <TelefonDialog onClose={() => setDialog(null)} onFertig={() => { setDialog(null); onAktualisieren(); melde("Telefonnummer bestätigt."); }} />}
      {dialog === "loeschen" && <LoeschenDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function TelefonDialog({ onClose, onFertig }) {
  const [nummer, setNummer] = useState("");
  const [code, setCode] = useState("");
  const [schritt, setSchritt] = useState("nummer");
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);

  async function weiter() {
    setFehler(null); setLaeuft(true);
    try {
      if (!LIVE) { setSchritt(schritt === "nummer" ? "code" : "nummer"); if (schritt === "code") onFertig(); return; }
      if (schritt === "nummer") { await api("/api/telefon/code", { method: "POST", body: { telefon: nummer } }); setSchritt("code"); }
      else { await api("/api/telefon/pruefen", { method: "POST", body: { telefon: nummer, code } }); onFertig(); }
    } catch (e) { setFehler(e.message); }
    finally { setLaeuft(false); }
  }

  return (
    <div className="cc-overlay" onClick={onClose}>
      <div className="cc-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Telefonnummer bestätigen</h3>
        <p>{schritt === "nummer" ? "Wir schicken dir einen Code per SMS. Bitte mit Ländervorwahl, zum Beispiel +49 170 1234567." : "Gib den Code aus der SMS ein."}</p>
        {fehler && <div className="cc-fehler" role="alert">{fehler}</div>}
        {schritt === "nummer"
          ? <input className="cc-input" type="tel" autoComplete="tel" placeholder="+49 …" value={nummer} onChange={(e) => setNummer(e.target.value)} />
          : <input className="cc-input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />}
        <button className="cc-knopf" disabled={laeuft || (schritt === "nummer" ? nummer.trim().length < 8 : code.trim().length < 4)} onClick={weiter}>
          {laeuft ? "Einen Moment …" : schritt === "nummer" ? "Code schicken" : "Bestätigen"}
        </button>
        <button className="cc-knopf cc-knopf--leise" onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

function LoeschenDialog({ onClose }) {
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  async function loeschen() {
    setLaeuft(true); setFehler(null);
    try { if (LIVE) await api("/api/konto/loeschen", { method: "POST" }); lokalAbmelden(); }
    catch (e) { setFehler(e.message); setLaeuft(false); }
  }
  return (
    <div className="cc-overlay" onClick={onClose}>
      <div className="cc-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Konto wirklich löschen?</h3>
        <p>Das lässt sich nicht rückgängig machen. Offenes Guthaben und laufende Auszahlungen verfallen.</p>
        {fehler && <div className="cc-fehler" role="alert">{fehler}</div>}
        <div className="cc-zeile-knoepfe">
          <button className="cc-knopf cc-knopf--leise" onClick={onClose}>Behalten</button>
          <button className="cc-knopf cc-knopf--rot" disabled={laeuft} onClick={loeschen} data-test="loeschen-bestaetigen">Endgültig löschen</button>
        </div>
      </div>
    </div>
  );
}

function SchrittZeile({ fertig, text, aktion, aktionText = "Erledigen" }) {
  return (
    <div className="cc-schritt">
      <span className={"cc-haken" + (fertig ? " cc-haken--ok" : "")}>{fertig ? "✓" : ""}</span>
      <span>{text}</span>
      {!fertig && <button className="cc-knopf cc-knopf--klein" onClick={aktion}>{aktionText}</button>}
    </div>
  );
}

/* ====================== Bausteine ====================== */

function Abschnitt({ titel, zusatz, children }) {
  return (
    <section className="cc-abschnitt">
      <div className="cc-abschnitt-kopf">
        <h2>{titel}</h2>
        {zusatz && <span>{zusatz}</span>}
      </div>
      {children}
    </section>
  );
}

function Hinweis({ titel, text }) {
  return (
    <div className="cc-hinweis">
      <strong>{titel}</strong>
      <p>{text}</p>
    </div>
  );
}

function Navigation({ tab, setTab }) {
  const punkte = [
    ["verdienen", "Verdienen"],
    ["bonus", "Bonus"],
    ["rang", "Rangliste"],
    ["auszahlen", "Auszahlen"],
    ["konto", "Konto"],
  ];
  return (
    <nav className="cc-nav">
      {punkte.map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)} className={"cc-nav-knopf" + (tab === id ? " cc-nav-knopf--an" : "")} data-test={"nav-" + id}>
          {label}
        </button>
      ))}
    </nav>
  );
}

/* ====================== Design ====================== */

function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@400;600&display=swap');

.cc-root {
  --ink:#16131F; --ink2:#1F1B2E; --ink3:#282239; --line:#372F4E;
  --gold:#F5C242; --coral:#FF6B5A; --mint:#6FD3A6; --paper:#F2EDE3; --muted:#9C93B0;
  --display:'Archivo', 'Helvetica Neue', sans-serif;
  --mono:'IBM Plex Mono', ui-monospace, Menlo, monospace;
  background: var(--ink); min-height:100vh; display:flex; justify-content:center;
  font-family: var(--display); color: var(--paper); -webkit-font-smoothing:antialiased;
}
.cc-phone { width:100%; max-width:460px; display:flex; flex-direction:column; min-height:100vh; position:relative; }
.cc-main { flex:1; padding:0 18px 110px; }
.cc-root button { font-family:inherit; cursor:pointer; }
.cc-root button:focus-visible, .cc-root input:focus-visible { outline:2px solid var(--gold); outline-offset:2px; }

/* Kopf */
.cc-kopf { padding:22px 18px 18px; background:linear-gradient(180deg,#221C33 0%,var(--ink) 100%); }
.cc-kopf-zeile { display:flex; align-items:center; gap:12px; }
.cc-avatar { width:40px; height:40px; border-radius:12px; background:var(--gold); color:var(--ink);
  display:grid; place-items:center; font-weight:900; font-size:18px; }
.cc-kopf-text { display:flex; flex-direction:column; flex:1; }
.cc-eyebrow { font-family:var(--mono); font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); }
.cc-name { font-size:17px; font-weight:700; }
.cc-streak { text-align:right; font-family:var(--mono); }
.cc-streak-zahl { display:block; font-size:20px; color:var(--gold); font-weight:600; }
.cc-streak-label { font-size:10px; color:var(--muted); letter-spacing:.12em; text-transform:uppercase; }

.cc-balance { margin-top:18px; display:flex; justify-content:space-between; align-items:flex-end;
  border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:14px 0; }
.cc-balance-eur { font-size:42px; font-weight:900; letter-spacing:-.03em; line-height:1; margin-top:4px; }
.cc-balance-coins { font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:6px; }
.cc-balance-rate { font-family:var(--mono); font-size:11px; color:var(--muted); text-align:right; line-height:1.7; }
.cc-gleich { display:block; color:var(--gold); }

.cc-xp { margin-top:12px; font-family:var(--mono); font-size:11px; color:var(--muted); }
.cc-xp-bar { height:4px; background:var(--ink3); border-radius:2px; overflow:hidden; margin-bottom:6px; }
.cc-xp-bar i { display:block; height:100%; background:var(--gold); }

/* Abschnitte */
.cc-abschnitt { margin-top:26px; }
.cc-abschnitt-kopf { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; }
.cc-abschnitt-kopf h2 { font-size:13px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; margin:0; }
.cc-abschnitt-kopf span { font-family:var(--mono); font-size:11px; color:var(--muted); }

.cc-hinweis { margin-top:20px; border:1px dashed var(--gold); border-radius:14px; padding:14px; background:rgba(245,194,66,.06); }
.cc-hinweis strong { display:block; font-size:14px; margin-bottom:4px; }
.cc-hinweis p { margin:0; font-size:13px; color:var(--muted); line-height:1.5; }

/* Offerwalls */
.cc-wall-reihe { display:flex; gap:10px; overflow-x:auto; padding-bottom:6px; }
.cc-wall { flex:0 0 132px; background:var(--ink2); border:1px solid var(--line); border-radius:14px;
  padding:14px 12px; text-align:left; color:var(--paper); }
.cc-wall-name { display:block; font-weight:700; font-size:14px; }
.cc-wall-typ { display:block; font-family:var(--mono); font-size:10px; color:var(--gold); margin-top:4px; text-transform:uppercase; letter-spacing:.1em; }
.cc-wall--aus { opacity:.45; }
.cc-wall-status { display:block; font-family:var(--mono); font-size:10px; color:var(--muted); margin-top:8px; }

/* Filter */
.cc-filter { display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; }
.cc-chip { flex:0 0 auto; background:transparent; border:1px solid var(--line); color:var(--muted);
  border-radius:999px; padding:7px 14px; font-size:12px; }
.cc-chip--an { background:var(--gold); color:var(--ink); border-color:var(--gold); font-weight:700; }

/* Aufgaben-Ticket */
.cc-liste { display:flex; flex-direction:column; gap:10px; }
.cc-karte { position:relative; display:flex; background:var(--ink2); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
.cc-karte-kerbe { position:absolute; right:104px; top:-9px; bottom:-9px; width:18px; }
.cc-karte-kerbe::before, .cc-karte-kerbe::after { content:""; position:absolute; left:0; width:18px; height:18px;
  border-radius:50%; background:var(--ink); }
.cc-karte-kerbe::before { top:0; } .cc-karte-kerbe::after { bottom:0; }
.cc-karte-inhalt { flex:1; padding:14px; min-width:0; }
.cc-karte-meta { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.cc-tag { font-family:var(--mono); font-size:9px; letter-spacing:.12em; text-transform:uppercase;
  background:var(--ink3); color:var(--gold); padding:3px 7px; border-radius:4px; }
.cc-anbieter { font-family:var(--mono); font-size:10px; color:var(--muted); }
.cc-karte-titel { font-size:15px; font-weight:700; margin:0 0 8px; line-height:1.25; }
.cc-karte-fuss { font-family:var(--mono); font-size:10px; color:var(--muted); display:flex; gap:5px; flex-wrap:wrap; }
.cc-punkt { opacity:.5; }
.cc-karte-wert { width:112px; border-left:1px dashed var(--line); padding:14px 10px; text-align:center;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; }
.cc-karte-wert strong { font-size:19px; font-weight:900; color:var(--gold); letter-spacing:-.02em; }
.cc-karte-wert span { font-family:var(--mono); font-size:10px; color:var(--muted); }
.cc-start { margin-top:8px; background:var(--paper); color:var(--ink); border:0; border-radius:999px;
  padding:7px 16px; font-size:12px; font-weight:700; }

/* Bonus */
.cc-tage { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:14px; }
.cc-tag-box { background:var(--ink2); border:1px solid var(--line); border-radius:10px; padding:8px 2px; text-align:center; }
.cc-tag-box--ok { background:rgba(111,211,166,.12); border-color:var(--mint); }
.cc-tag-box--heute { border-color:var(--gold); background:rgba(245,194,66,.12); }
.cc-tag-nr { display:block; font-family:var(--mono); font-size:9px; color:var(--muted); }
.cc-tag-coins { display:block; font-size:11px; font-weight:700; margin-top:3px; }

.cc-flaeche { background:var(--ink2); border:1px solid var(--line); border-radius:16px; padding:16px; }
.cc-flaeche-text { margin:0 0 12px; font-size:14px; line-height:1.5; }
.cc-code { display:flex; align-items:center; justify-content:space-between; gap:10px;
  border:1px dashed var(--line); border-radius:10px; padding:10px 12px; font-family:var(--mono); font-size:15px; color:var(--gold); }
.cc-klein { font-size:11px; color:var(--muted); line-height:1.6; margin:10px 0 0; }

.cc-knopf { width:100%; background:var(--gold); color:var(--ink); border:0; border-radius:12px;
  padding:14px; font-size:14px; font-weight:900; letter-spacing:.02em; }
.cc-knopf:disabled { background:var(--ink3); color:var(--muted); }
.cc-knopf--klein { width:auto; padding:7px 14px; font-size:12px; border-radius:999px; }

/* Rangliste */
.cc-rang { display:flex; flex-direction:column; }
.cc-rang-zeile { display:flex; align-items:center; gap:12px; padding:13px 12px; border-bottom:1px solid var(--line); }
.cc-rang-zeile--ich { background:rgba(245,194,66,.09); border-radius:10px; border-bottom-color:transparent; }
.cc-rang-platz { font-family:var(--mono); font-size:13px; color:var(--gold); }
.cc-rang-name { flex:1; font-size:14px; font-weight:600; }
.cc-rang-coins { font-family:var(--mono); font-size:12px; color:var(--muted); }

/* Auszahlen */
.cc-payout-gitter { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
.cc-payout { background:var(--ink2); border:1px solid var(--line); border-radius:14px; padding:14px 12px;
  text-align:left; color:var(--paper); }
.cc-payout--an { border-color:var(--gold); background:rgba(245,194,66,.1); }
.cc-payout--aus { opacity:.5; }
.cc-payout-name { display:block; font-weight:700; font-size:14px; }
.cc-payout-min { display:block; font-family:var(--mono); font-size:11px; color:var(--gold); margin-top:3px; }
.cc-payout-fuss { display:block; font-family:var(--mono); font-size:10px; color:var(--muted); margin-top:8px; }
.cc-payout-fuss--rot { color:var(--coral); }

.cc-label { font-family:var(--mono); font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
.cc-input { width:100%; margin:6px 0 14px; background:var(--ink); border:1px solid var(--line); border-radius:10px;
  padding:12px; color:var(--paper); font-family:var(--mono); font-size:13px; box-sizing:border-box; }
.cc-rechnung { font-family:var(--mono); font-size:12px; margin-bottom:14px; }
.cc-rechnung > div { display:flex; justify-content:space-between; padding:6px 0; color:var(--muted); }
.cc-rechnung-summe { border-top:1px solid var(--line); margin-top:4px; padding-top:10px !important; color:var(--paper) !important; font-weight:600; }

.cc-verlauf { display:flex; flex-direction:column; }
.cc-verlauf-zeile { display:flex; justify-content:space-between; gap:12px; padding:13px 0; border-bottom:1px solid var(--line); }
.cc-verlauf-zeile strong { display:block; font-size:13px; font-weight:600; }
.cc-verlauf-meta { font-family:var(--mono); font-size:10px; color:var(--muted); }
.cc-verlauf-rechts { text-align:right; white-space:nowrap; }
.cc-betrag { display:block; font-family:var(--mono); font-size:13px; color:var(--mint); }
.cc-betrag--ab { color:var(--paper); }
.cc-status { font-family:var(--mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; }
.cc-status--ok { color:var(--mint); } .cc-status--warte { color:var(--gold); } .cc-status--weg { color:var(--coral); }

/* Beleg */
.cc-overlay { position:fixed; inset:0; background:rgba(10,8,16,.75); display:grid; place-items:center; padding:24px; z-index:50; }
.cc-beleg { width:100%; max-width:330px; animation:ccRein .28s ease-out; }
@keyframes ccRein { from { transform:translateY(14px); opacity:0; } to { transform:none; opacity:1; } }
@media (prefers-reduced-motion: reduce) { .cc-beleg { animation:none; } }
.cc-beleg-inhalt { background:var(--paper); color:var(--ink); padding:22px; }
.cc-beleg-kante { height:10px; background:
  radial-gradient(circle at 6px 0, transparent 6px, var(--paper) 6px) repeat-x; background-size:12px 10px; }
.cc-beleg-kante--oben { transform:rotate(180deg); }
.cc-beleg-marke { font-family:var(--mono); font-size:10px; letter-spacing:.34em; }
.cc-beleg-titel { font-size:26px; font-weight:900; letter-spacing:-.02em; margin:6px 0 16px; }
.cc-beleg-daten { font-family:var(--mono); font-size:12px; margin:0 0 14px; border-top:1px dashed #B7AE9C; }
.cc-beleg-daten > div { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px dashed #B7AE9C; }
.cc-beleg-daten dt, .cc-beleg-daten dd { margin:0; }
.cc-beleg-daten dt { color:#6C6353; }
.cc-beleg-text { font-size:12px; line-height:1.55; color:#4A4436; margin:0 0 16px; }

/* Sicherheit */
.cc-risiko { margin-bottom:14px; }
.cc-risiko-bar { height:6px; background:var(--ink3); border-radius:3px; overflow:hidden; margin-bottom:8px; }
.cc-risiko-bar i { display:block; height:100%; }
.cc-risiko-bar .gruen { background:var(--mint); } .cc-risiko-bar .gelb { background:var(--gold); } .cc-risiko-bar .rot { background:var(--coral); }
.cc-signal { display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid var(--line); font-size:13px; }
.cc-signal-punkt { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
.cc-signal-punkt.ok { background:var(--mint); } .cc-signal-punkt.offen { background:var(--gold); }
.cc-signal-label { flex:1; }
.cc-signal-wert { font-family:var(--mono); font-size:11px; color:var(--muted); }
.cc-schritt { display:flex; align-items:center; gap:10px; padding:10px 0; font-size:13px; border-top:1px solid var(--line); }
.cc-schritt:first-child { border-top:0; }
.cc-haken { width:20px; height:20px; border-radius:6px; border:1px solid var(--line); display:grid; place-items:center; font-size:12px; flex:0 0 auto; }
.cc-haken--ok { background:var(--mint); color:var(--ink); border-color:var(--mint); }

/* Navigation */
.cc-nav { position:fixed; bottom:0; width:100%; max-width:460px; display:flex; background:rgba(22,19,31,.94);
  backdrop-filter:blur(12px); border-top:1px solid var(--line); padding:10px 6px 22px; }
.cc-nav-knopf { flex:1; background:none; border:0; color:var(--muted); font-size:11px; font-weight:600;
  padding:8px 2px; border-radius:8px; }
.cc-nav-knopf--an { color:var(--gold); background:rgba(245,194,66,.1); }

/* Anmeldung */
.cc-login { padding:48px 22px 40px; display:flex; flex-direction:column; min-height:100vh; }
.cc-login-marke { font-family:var(--mono); font-size:11px; letter-spacing:.34em; color:var(--gold); }
.cc-login h1 { font-size:34px; font-weight:900; letter-spacing:-.03em; margin:8px 0 6px; line-height:1.05; }
.cc-login-text { color:var(--muted); font-size:14px; line-height:1.5; margin:0 0 26px; }
.cc-login .cc-input { margin-bottom:10px; }
.cc-login-wechsel { background:none; border:0; color:var(--gold); font-size:13px; margin-top:16px; text-decoration:underline; }
.cc-fehler { background:rgba(255,107,90,.12); border:1px solid var(--coral); color:var(--paper); border-radius:10px;
  padding:10px 12px; font-size:13px; margin:0 0 12px; line-height:1.45; }
.cc-ok { background:rgba(111,211,166,.12); border:1px solid var(--mint); color:var(--paper); border-radius:10px;
  padding:10px 12px; font-size:13px; margin:0 0 12px; line-height:1.45; }
.cc-laden { display:grid; place-items:center; min-height:60vh; font-family:var(--mono); font-size:12px; color:var(--muted); letter-spacing:.14em; text-transform:uppercase; }

/* Meldung (Toast) */
.cc-meldung { position:fixed; left:50%; bottom:96px; transform:translateX(-50%); max-width:420px; width:calc(100% - 36px);
  background:var(--paper); color:var(--ink); border-radius:12px; padding:12px 14px; font-size:13px; line-height:1.45;
  box-shadow:0 12px 40px rgba(0,0,0,.45); z-index:60; display:flex; gap:12px; align-items:flex-start; }
.cc-meldung button { background:none; border:0; color:var(--ink); font-weight:900; font-size:16px; line-height:1; padding:0; }

/* Dialog (Telefon, Konto loeschen) */
.cc-dialog { width:100%; max-width:360px; background:var(--ink2); border:1px solid var(--line); border-radius:18px; padding:20px; }
.cc-dialog h3 { margin:0 0 6px; font-size:18px; font-weight:900; }
.cc-dialog p { margin:0 0 14px; font-size:13px; color:var(--muted); line-height:1.5; }
.cc-dialog .cc-input { margin:6px 0 12px; }
.cc-knopf--leise { background:transparent; color:var(--muted); border:1px solid var(--line); margin-top:8px; }
.cc-knopf--rot { background:var(--coral); color:var(--ink); }
.cc-zeile-knoepfe { display:flex; gap:10px; margin-top:16px; }
.cc-zeile-knoepfe .cc-knopf { margin-top:0; }
.cc-betrag-eingabe { display:flex; gap:8px; align-items:center; }
.cc-betrag-eingabe .cc-input { flex:1; }
.cc-betrag-eingabe span { font-family:var(--mono); color:var(--muted); font-size:13px; margin-bottom:8px; }
.cc-status--offen { color:var(--gold); }
.cc-leer { text-align:center; padding:28px 12px; color:var(--muted); font-size:13px; line-height:1.5; }
`}</style>
  );
}
