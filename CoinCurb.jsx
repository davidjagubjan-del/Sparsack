import React, { useState, useMemo } from "react";

/* ============================================================
   HIER EINPFLEGEN — Partner & Auszahlungen
   Trage die Zugangsdaten ein. Alles was leer bleibt, erscheint
   in der App als "nicht verbunden" und wird nicht angezeigt.
   WICHTIG: Secrets NIEMALS hier, sondern nur im Backend (.env).
   Hier stehen ausschliesslich oeffentliche IDs.
   ============================================================ */

const API_BASE = ""; // z.B. "https://api.deine-domain.de" — leer = Demo-Daten

const PARTNER = [
  { id: "adgate",   name: "AdGate Media",  typ: "Offerwall", pubId: "", wallUrl: "https://wall.adgaterewards.com/{pubId}/{userId}" },
  { id: "ayet",     name: "AyeT Studios",  typ: "Offerwall", pubId: "", wallUrl: "https://www.ayetstudios.com/offers/web_offerwall/{pubId}?external_identifier={userId}" },
  { id: "torox",    name: "Torox",         typ: "Offerwall", pubId: "", wallUrl: "https://torox.io/ifr/{pubId}?user_id={userId}" },
  { id: "lootably", name: "Lootably",      typ: "Offerwall", pubId: "", wallUrl: "https://wall.lootably.com/?placementID={pubId}&userID={userId}" },
  { id: "bitlabs",  name: "BitLabs",       typ: "Umfragen",  pubId: "", wallUrl: "https://web.bitlabs.ai/?token={pubId}&uid={userId}" },
  { id: "cpx",      name: "CPX Research",  typ: "Umfragen",  pubId: "", wallUrl: "https://offers.cpx-research.com/index.php?app_id={pubId}&ext_user_id={userId}" },
  { id: "pollfish", name: "Pollfish",      typ: "Umfragen",  pubId: "", wallUrl: "" },
];

const PAYOUTS = [
  { id: "paypal",   name: "PayPal",           min: 5,  gebuehr: 0,    dauer: "1–24 Std", aktiv: false, feld: "E-Mail-Adresse" },
  { id: "amazon",   name: "Amazon Gutschein", min: 5,  gebuehr: 0,    dauer: "sofort",   aktiv: false, feld: "E-Mail-Adresse" },
  { id: "bank",     name: "SEPA-Ueberweisung",min: 20, gebuehr: 0.35, dauer: "1–3 Tage", aktiv: false, feld: "IBAN" },
  { id: "steam",    name: "Steam Guthaben",   min: 5,  gebuehr: 0,    dauer: "sofort",   aktiv: false, feld: "E-Mail-Adresse" },
  { id: "crypto",   name: "Bitcoin / USDT",   min: 10, gebuehr: 0.50, dauer: "1–2 Std",  aktiv: false, feld: "Wallet-Adresse" },
  { id: "visa",     name: "Visa Prepaid",     min: 25, gebuehr: 1.00, dauer: "1–24 Std", aktiv: false, feld: "E-Mail-Adresse" },
];

const COINS_PRO_EURO = 1000;

/* ====================== Demo-Daten ====================== */

const DEMO_USER = {
  name: "Jonas",
  level: 7,
  xp: 2340,
  xpZiel: 3000,
  coins: 18420,
  streak: 6,
  verifiziert: { mail: true, telefon: false, ausweis: false },
};

const DEMO_ANGEBOTE = [
  { id: 1, titel: "Coin Master — Dorf 12 erreichen", anbieter: "AdGate Media", coins: 14200, minuten: 90, typ: "Spiel", schwer: 3, quote: 71 },
  { id: 2, titel: "Umfrage: Einkaufsgewohnheiten", anbieter: "CPX Research", coins: 1350, minuten: 12, typ: "Umfrage", schwer: 1, quote: 88 },
  { id: 3, titel: "Trading-App — Konto verifizieren", anbieter: "Torox", coins: 32500, minuten: 25, typ: "Anmeldung", schwer: 2, quote: 64 },
  { id: 4, titel: "Match Blast — Level 40", anbieter: "AyeT Studios", coins: 8900, minuten: 60, typ: "Spiel", schwer: 2, quote: 76 },
  { id: 5, titel: "Streaming 7 Tage testen", anbieter: "Lootably", coins: 6400, minuten: 8, typ: "Testphase", schwer: 1, quote: 82 },
  { id: 6, titel: "Kurzumfrage: Mobilitaet", anbieter: "BitLabs", coins: 620, minuten: 5, typ: "Umfrage", schwer: 1, quote: 91 },
];

const DEMO_VERLAUF = [
  { id: "TX-8842", was: "Match Blast — Level 20", coins: 3100, status: "gutgeschrieben", zeit: "vor 2 Std" },
  { id: "TX-8839", was: "Umfrage: Ernaehrung", coins: 940, status: "in Pruefung", zeit: "vor 4 Std", frei: "in 68 Std" },
  { id: "TX-8830", was: "PayPal Auszahlung", coins: -5000, status: "ausgezahlt", zeit: "gestern" },
  { id: "TX-8811", was: "Taegliche Belohnung", coins: 250, status: "gutgeschrieben", zeit: "gestern" },
  { id: "TX-8790", was: "Fitness-App Anmeldung", coins: 2400, status: "storniert", zeit: "vor 3 Tagen", grund: "Partner hat die Buchung zurueckgezogen" },
];

const DEMO_RANGLISTE = [
  { platz: 1, name: "kevin_ffm", coins: 412000 },
  { platz: 2, name: "sanni", coins: 388400 },
  { platz: 3, name: "m4rc0", coins: 351200 },
  { platz: 4, name: "Jonas", coins: 298650, ich: true },
  { platz: 5, name: "lea.k", coins: 244100 },
];

/* Risiko-Signale kommen im Echtbetrieb vom Backend (/api/security) */
const DEMO_RISIKO = {
  punkte: 18,
  stufe: "normal",
  signale: [
    { label: "Geraet seit 84 Tagen bekannt", wert: "unauffaellig", ok: true },
    { label: "Konten auf diesem Geraet", wert: "1", ok: true },
    { label: "Netzwerk", wert: "Mobilfunk, kein Proxy", ok: true },
    { label: "Bearbeitungszeit pro Aufgabe", wert: "im Normbereich", ok: true },
    { label: "Telefonnummer bestaetigt", wert: "offen", ok: false },
  ],
};

/* ====================== Helfer ====================== */

const eur = (coins) => (coins / COINS_PRO_EURO).toFixed(2).replace(".", ",") + " €";
const zahl = (n) => n.toLocaleString("de-DE");

function verbundenePartner() {
  return PARTNER.filter((p) => p.pubId.trim() !== "");
}
function aktivePayouts() {
  return PAYOUTS.filter((p) => p.aktiv);
}

/* ====================== App ====================== */

export default function App() {
  const [tab, setTab] = useState("verdienen");
  const [user] = useState(DEMO_USER);
  const [beleg, setBeleg] = useState(null);

  return (
    <div className="cc-root">
      <Styles />
      <div className="cc-phone">
        <Kopf user={user} />
        <main className="cc-main">
          {tab === "verdienen" && <Verdienen user={user} />}
          {tab === "bonus" && <Bonus user={user} />}
          {tab === "rang" && <Rangliste />}
          {tab === "auszahlen" && <Auszahlen user={user} onBeleg={setBeleg} />}
          {tab === "konto" && <Konto user={user} />}
        </main>
        <Navigation tab={tab} setTab={setTab} />
      </div>
      {beleg && <BelegOverlay beleg={beleg} onClose={() => setBeleg(null)} />}
    </div>
  );
}

/* ====================== Kopf ====================== */

function Kopf({ user }) {
  const fortschritt = Math.min(100, (user.xp / user.xpZiel) * 100);
  return (
    <header className="cc-kopf">
      <div className="cc-kopf-zeile">
        <div className="cc-avatar">{user.name[0]}</div>
        <div className="cc-kopf-text">
          <span className="cc-eyebrow">Stufe {user.level}</span>
          <strong className="cc-name">{user.name}</strong>
        </div>
        <div className="cc-streak" title="Tage in Folge aktiv">
          <span className="cc-streak-zahl">{user.streak}</span>
          <span className="cc-streak-label">Tage</span>
        </div>
      </div>

      <div className="cc-balance">
        <div>
          <span className="cc-eyebrow">Guthaben</span>
          <div className="cc-balance-eur">{eur(user.coins)}</div>
          <div className="cc-balance-coins">{zahl(user.coins)} Coins</div>
        </div>
        <div className="cc-balance-rate">
          <span>1.000 Coins</span>
          <span className="cc-gleich">=</span>
          <span>1,00 €</span>
        </div>
      </div>

      <div className="cc-xp">
        <div className="cc-xp-bar"><i style={{ width: fortschritt + "%" }} /></div>
        <span>Noch {zahl(user.xpZiel - user.xp)} XP bis Stufe {user.level + 1}</span>
      </div>
    </header>
  );
}

/* ====================== Verdienen ====================== */

function Verdienen({ user }) {
  const [filter, setFilter] = useState("Alle");
  const partner = verbundenePartner();
  const typen = ["Alle", "Spiel", "Umfrage", "Anmeldung", "Testphase"];

  const angebote = useMemo(
    () => (filter === "Alle" ? DEMO_ANGEBOTE : DEMO_ANGEBOTE.filter((a) => a.typ === filter)),
    [filter]
  );

  return (
    <>
      {partner.length === 0 && (
        <Hinweis
          titel="Noch keine Anbieter verbunden"
          text="Trage oben in der Datei bei PARTNER deine Publisher-IDs ein. Danach erscheinen hier die echten Angebote statt der Beispiele."
        />
      )}

      <Abschnitt titel="Anbieter" zusatz={`${partner.length || PARTNER.length} Waende`}>
        <div className="cc-wall-reihe">
          {PARTNER.map((p) => (
            <button
              key={p.id}
              className={"cc-wall" + (p.pubId ? "" : " cc-wall--aus")}
              onClick={() => {
                if (!p.pubId) return;
                const url = p.wallUrl.replace("{pubId}", p.pubId).replace("{userId}", "USER_ID");
                window.open(url, "_blank");
              }}
            >
              <span className="cc-wall-name">{p.name}</span>
              <span className="cc-wall-typ">{p.typ}</span>
              {!p.pubId && <span className="cc-wall-status">nicht verbunden</span>}
            </button>
          ))}
        </div>
      </Abschnitt>

      <Abschnitt titel="Aufgaben">
        <div className="cc-filter">
          {typen.map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={"cc-chip" + (filter === t ? " cc-chip--an" : "")}>
              {t}
            </button>
          ))}
        </div>

        <div className="cc-liste">
          {angebote.map((a) => <AngebotKarte key={a.id} a={a} />)}
        </div>
      </Abschnitt>
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

function Bonus({ user }) {
  const [geholt, setGeholt] = useState(false);
  const tage = [250, 300, 400, 500, 700, 1000, 2500];

  return (
    <>
      <Abschnitt titel="Taegliche Belohnung" zusatz={`Tag ${user.streak} von 7`}>
        <div className="cc-tage">
          {tage.map((c, i) => {
            const erledigt = i < user.streak;
            const heute = i === user.streak;
            return (
              <div key={i} className={"cc-tag-box" + (erledigt ? " cc-tag-box--ok" : "") + (heute ? " cc-tag-box--heute" : "")}>
                <span className="cc-tag-nr">{i + 1}</span>
                <span className="cc-tag-coins">{c}</span>
              </div>
            );
          })}
        </div>
        <button className="cc-knopf" disabled={geholt} onClick={() => setGeholt(true)}>
          {geholt ? "Fuer heute abgeholt" : `${tage[user.streak]} Coins abholen`}
        </button>
        <p className="cc-klein">Verpasst du einen Tag, faengt die Serie wieder bei Tag 1 an.</p>
      </Abschnitt>

      <Abschnitt titel="Freunde einladen">
        <div className="cc-flaeche">
          <p className="cc-flaeche-text">
            Du bekommst dauerhaft <strong>10 % von allem</strong>, was deine Eingeladenen verdienen — ohne dass ihnen etwas abgezogen wird.
          </p>
          <div className="cc-code">
            <span>JONAS-7K2</span>
            <button className="cc-knopf cc-knopf--klein">Kopieren</button>
          </div>
          <p className="cc-klein">
            Einladungen zaehlen erst, wenn der Freund 2,00 € selbst verdient hat. Gleiches Geraet oder gleiches Netzwerk zaehlt nicht.
          </p>
        </div>
      </Abschnitt>
    </>
  );
}

/* ====================== Rangliste ====================== */

function Rangliste() {
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

function Auszahlen({ user, onBeleg }) {
  const aktiv = aktivePayouts();
  const liste = aktiv.length ? aktiv : PAYOUTS;
  const [gewaehlt, setGewaehlt] = useState(null);
  const [ziel, setZiel] = useState("");
  const guthabenEur = user.coins / COINS_PRO_EURO;

  const methode = liste.find((m) => m.id === gewaehlt);
  const genug = methode ? guthabenEur >= methode.min : false;

  return (
    <>
      {aktiv.length === 0 && (
        <Hinweis
          titel="Noch keine Auszahlungsart freigeschaltet"
          text='Setze oben bei PAYOUTS die gewuenschte Art auf aktiv: true und hinterlege die Zugangsdaten des Anbieters im Backend.'
        />
      )}

      <Abschnitt titel="Auszahlen" zusatz={eur(user.coins) + " verfuegbar"}>
        <div className="cc-payout-gitter">
          {liste.map((m) => {
            const reicht = guthabenEur >= m.min;
            return (
              <button
                key={m.id}
                onClick={() => setGewaehlt(m.id)}
                className={
                  "cc-payout" +
                  (gewaehlt === m.id ? " cc-payout--an" : "") +
                  (m.aktiv ? "" : " cc-payout--aus")
                }
              >
                <span className="cc-payout-name">{m.name}</span>
                <span className="cc-payout-min">ab {m.min.toFixed(2).replace(".", ",")} €</span>
                <span className={"cc-payout-fuss" + (reicht ? "" : " cc-payout-fuss--rot")}>
                  {m.aktiv ? (reicht ? m.dauer : "Guthaben reicht nicht") : "nicht eingerichtet"}
                </span>
              </button>
            );
          })}
        </div>

        {methode && (
          <div className="cc-flaeche">
            <label className="cc-label">{methode.feld}</label>
            <input
              className="cc-input"
              value={ziel}
              onChange={(e) => setZiel(e.target.value)}
              placeholder={methode.feld}
            />
            <div className="cc-rechnung">
              <div><span>Betrag</span><span>{methode.min.toFixed(2).replace(".", ",")} €</span></div>
              <div><span>Gebuehr</span><span>{methode.gebuehr ? "-" + methode.gebuehr.toFixed(2).replace(".", ",") + " €" : "keine"}</span></div>
              <div className="cc-rechnung-summe">
                <span>Du bekommst</span>
                <span>{(methode.min - methode.gebuehr).toFixed(2).replace(".", ",")} €</span>
              </div>
            </div>
            <button
              className="cc-knopf"
              disabled={!genug || !ziel.trim() || !methode.aktiv}
              onClick={() =>
                onBeleg({
                  id: "AZ-" + Math.floor(100000 + Math.random() * 899999),
                  methode: methode.name,
                  ziel: ziel,
                  betrag: methode.min - methode.gebuehr,
                  pruefung: DEMO_RISIKO.punkte >= 30,
                })
              }
            >
              Auszahlung anfordern
            </button>
            <p className="cc-klein">
              Erste Auszahlung erst nach bestaetigter Telefonnummer. Neu verdiente Coins sind 72 Stunden gesperrt,
              damit stornierte Buchungen der Partner noch abgezogen werden koennen.
            </p>
          </div>
        )}
      </Abschnitt>

      <Abschnitt titel="Verlauf">
        <div className="cc-verlauf">
          {DEMO_VERLAUF.map((v) => (
            <div key={v.id} className="cc-verlauf-zeile">
              <div>
                <strong>{v.was}</strong>
                <span className="cc-verlauf-meta">
                  {v.id} · {v.zeit}
                  {v.frei ? " · frei " + v.frei : ""}
                  {v.grund ? " · " + v.grund : ""}
                </span>
              </div>
              <div className="cc-verlauf-rechts">
                <span className={"cc-betrag" + (v.coins < 0 ? " cc-betrag--ab" : "")}>
                  {v.coins > 0 ? "+" : ""}{zahl(v.coins)}
                </span>
                <StatusPunkt status={v.status} />
              </div>
            </div>
          ))}
        </div>
      </Abschnitt>
    </>
  );
}

function StatusPunkt({ status }) {
  const klasse =
    status === "gutgeschrieben" || status === "ausgezahlt" ? "ok" : status === "in Pruefung" ? "warte" : "weg";
  return <span className={"cc-status cc-status--" + klasse}>{status}</span>;
}

/* Signatur der App: der Auszahlungsbeleg */
function BelegOverlay({ beleg, onClose }) {
  return (
    <div className="cc-overlay" onClick={onClose}>
      <div className="cc-beleg" onClick={(e) => e.stopPropagation()}>
        <div className="cc-beleg-kante cc-beleg-kante--oben" />
        <div className="cc-beleg-inhalt">
          <span className="cc-beleg-marke">COINCURB</span>
          <h2 className="cc-beleg-titel">{beleg.pruefung ? "In Pruefung" : "Angefordert"}</h2>
          <dl className="cc-beleg-daten">
            <div><dt>Beleg</dt><dd>{beleg.id}</dd></div>
            <div><dt>Weg</dt><dd>{beleg.methode}</dd></div>
            <div><dt>Ziel</dt><dd>{beleg.ziel}</dd></div>
            <div><dt>Betrag</dt><dd>{beleg.betrag.toFixed(2).replace(".", ",")} €</dd></div>
          </dl>
          <p className="cc-beleg-text">
            {beleg.pruefung
              ? "Ein Mitarbeiter schaut sich das Konto an. Das dauert in der Regel bis zu 24 Stunden."
              : "Der Auftrag laeuft. Du bekommst eine Nachricht, sobald das Geld raus ist."}
          </p>
          <button className="cc-knopf" onClick={onClose}>Schliessen</button>
        </div>
        <div className="cc-beleg-kante cc-beleg-kante--unten" />
      </div>
    </div>
  );
}

/* ====================== Konto & Sicherheit ====================== */

function Konto({ user }) {
  const r = DEMO_RISIKO;
  return (
    <>
      <Abschnitt titel="Verifizierung">
        <div className="cc-flaeche">
          <SchrittZeile fertig={user.verifiziert.mail} text="E-Mail bestaetigt" />
          <SchrittZeile fertig={user.verifiziert.telefon} text="Telefonnummer bestaetigt — noetig fuer die erste Auszahlung" />
          <SchrittZeile fertig={user.verifiziert.ausweis} text="Ausweis — noetig ab 100 € Auszahlung im Monat" />
        </div>
      </Abschnitt>

      <Abschnitt titel="Kontosicherheit" zusatz={r.stufe}>
        <div className="cc-flaeche">
          <div className="cc-risiko">
            <div className="cc-risiko-bar">
              <i style={{ width: r.punkte + "%" }} className={r.punkte < 30 ? "gruen" : r.punkte < 60 ? "gelb" : "rot"} />
            </div>
            <span className="cc-klein">
              Wir pruefen jedes Konto automatisch. Unter 30 Punkten laeuft alles ohne Wartezeit durch.
            </span>
          </div>
          {r.signale.map((s, i) => (
            <div key={i} className="cc-signal">
              <span className={"cc-signal-punkt" + (s.ok ? " ok" : " offen")} />
              <span className="cc-signal-label">{s.label}</span>
              <span className="cc-signal-wert">{s.wert}</span>
            </div>
          ))}
        </div>
      </Abschnitt>

      <Abschnitt titel="Anbieter-Status">
        <div className="cc-flaeche">
          {PARTNER.map((p) => (
            <div key={p.id} className="cc-signal">
              <span className={"cc-signal-punkt" + (p.pubId ? " ok" : " offen")} />
              <span className="cc-signal-label">{p.name}</span>
              <span className="cc-signal-wert">{p.pubId ? "verbunden" : "ID fehlt"}</span>
            </div>
          ))}
          {PAYOUTS.map((p) => (
            <div key={p.id} className="cc-signal">
              <span className={"cc-signal-punkt" + (p.aktiv ? " ok" : " offen")} />
              <span className="cc-signal-label">{p.name}</span>
              <span className="cc-signal-wert">{p.aktiv ? "aktiv" : "aus"}</span>
            </div>
          ))}
        </div>
      </Abschnitt>
    </>
  );
}

function SchrittZeile({ fertig, text }) {
  return (
    <div className="cc-schritt">
      <span className={"cc-haken" + (fertig ? " cc-haken--ok" : "")}>{fertig ? "✓" : ""}</span>
      <span>{text}</span>
      {!fertig && <button className="cc-knopf cc-knopf--klein">Erledigen</button>}
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
        <button key={id} onClick={() => setTab(id)} className={"cc-nav-knopf" + (tab === id ? " cc-nav-knopf--an" : "")}>
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
`}</style>
  );
}
