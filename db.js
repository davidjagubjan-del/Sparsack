/**
 * CoinCurb — Datenbankschicht (PostgreSQL)
 * npm i pg
 * Hier stecken alle Funktionen, die server.js und auth.js aufrufen.
 */

import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const q = (sql, p = []) => pool.query(sql, p);
const eine = async (sql, p) => (await q(sql, p)).rows[0] || null;

/** Alles, was identifiziert, wird gehasht gespeichert — nie im Klartext. */
if (!process.env.HASH_PEPPER || process.env.HASH_PEPPER.length < 32)
  throw new Error("HASH_PEPPER fehlt oder ist zu kurz (mindestens 32 Zeichen).");
export const hash = (wert) =>
  crypto.createHmac("sha256", process.env.HASH_PEPPER).update(String(wert)).digest("hex");

/** Auszahlungsziele liegen verschluesselt in der DB (pgcrypto), Klartext nur beim Senden. */
if (!process.env.ZIEL_SCHLUESSEL || process.env.ZIEL_SCHLUESSEL.length < 32)
  throw new Error("ZIEL_SCHLUESSEL fehlt oder ist zu kurz (mindestens 32 Zeichen).");
const ZIEL_SCHLUESSEL = process.env.ZIEL_SCHLUESSEL;

const HALTEFRIST_STD = 72;

export const db = {
  /* ---------- Konten ---------- */

  nutzer: (id) => eine(`SELECT * FROM nutzer WHERE id=$1`, [id]),
  nutzerNachEmail: (email) => eine(`SELECT * FROM nutzer WHERE email=$1`, [email]),
  emailVergeben: async (email) => !!(await eine(`SELECT 1 FROM nutzer WHERE email=$1`, [email.toLowerCase()])),
  aktivGesehen: (id) => q(`UPDATE nutzer SET zuletzt_aktiv=now() WHERE id=$1`, [id]),

  nutzerAnlegen: ({ email, passwortHash, anzeigename, geworbenVon }) =>
    eine(`INSERT INTO nutzer (email, passwort_hash, anzeigename, geworben_von)
          VALUES ($1,$2,$3,$4) RETURNING *`, [email, passwortHash, anzeigename, geworbenVon]),

  nutzerNachApple: async (sub, email) =>
    (await eine(`SELECT * FROM nutzer WHERE apple_sub=$1`, [sub])) ||
    (await eine(`INSERT INTO nutzer (apple_sub, email, anzeigename, email_bestaetigt)
                 VALUES ($1,$2,$3,TRUE) RETURNING *`, [sub, email, (email || "Spieler").split("@")[0]])),

  nutzerSperren: async (id, grund) => {
    await q(`UPDATE nutzer SET gesperrt=TRUE, sperrgrund=$2 WHERE id=$1`, [id, grund]);
    await db.protokoll(id, "sperre", { grund });
  },
  nutzerEntsperren: async (id, wer) => {
    await q(`UPDATE nutzer SET gesperrt=FALSE, sperrgrund=NULL WHERE id=$1`, [id]);
    await db.protokoll(id, "entsperrt", { wer });
  },

  emailBestaetigt: (id) => q(`UPDATE nutzer SET email_bestaetigt=TRUE WHERE id=$1`, [id]),
  telefonBestaetigt: (id, nr) =>
    q(`UPDATE nutzer SET telefon=$2, telefon_bestaetigt=TRUE WHERE id=$1`, [id, hash(nr)]),
  telefonVergeben: async (nr, ausser) =>
    !!(await eine(`SELECT 1 FROM nutzer WHERE telefon=$1 AND id<>$2`, [hash(nr), ausser])),

  kontoLoeschen: (id) =>
    q(`UPDATE nutzer SET geloescht_am=now(), email=id||'@geloescht.invalid', passwort_hash=NULL,
              telefon=NULL, anzeigename='Gelöscht', apple_sub=NULL, google_sub=NULL WHERE id=$1`, [id]),

  /* ---------- Sitzungen & Codes ---------- */

  sitzungAnlegen: ({ nutzerId, geraetId, ipHash, refreshHash, laeuftAb }) =>
    eine(`INSERT INTO sitzungen (nutzer_id, geraet_id, ip_hash, refresh_hash, laeuft_ab)
          VALUES ($1,$2,$3,$4,$5) RETURNING id`, [nutzerId, geraetId, ipHash, refreshHash, laeuftAb]),
  sitzungNachHash: (h) => eine(`SELECT * FROM sitzungen WHERE refresh_hash=$1`, [h]),
  sitzungWiderrufen: (id) => q(`UPDATE sitzungen SET widerrufen=TRUE WHERE id=$1`, [id]),
  sitzungenWiderrufen: (nutzerId) => q(`UPDATE sitzungen SET widerrufen=TRUE WHERE nutzer_id=$1`, [nutzerId]),

  codeAnlegen: ({ nutzerId, zweck, codeHash, minuten }) =>
    q(`INSERT INTO codes (nutzer_id, zweck, code_hash, laeuft_ab)
       VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`, [nutzerId, zweck, codeHash, minuten]),

  codeEinloesen: async ({ zweck, codeHash, nutzerId = null, maxVersuche = 10 }) => {
    const c = await eine(
      `SELECT * FROM codes WHERE zweck=$1 AND code_hash=$2 AND eingeloest IS NULL
         AND laeuft_ab > now() AND versuche < $3 AND ($4::uuid IS NULL OR nutzer_id=$4)`,
      [zweck, codeHash, maxVersuche, nutzerId]);
    if (!c) return null;
    await q(`UPDATE codes SET eingeloest=now() WHERE id=$1`, [c.id]);
    return c;
  },

  /* ---------- Geräte ---------- */

  geraetMerken: ({ fingerprint, plattform, emulator, rootJailbreak }) =>
    eine(`INSERT INTO geraete (fingerprint, plattform, emulator, root_jailbreak)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (fingerprint) DO UPDATE SET zuletzt=now()
          RETURNING *`, [fingerprint, plattform, emulator, rootJailbreak]),

  geraetVerknuepfen: ({ nutzerId, geraetId, ipHash, ipTyp, ipLand }) =>
    q(`INSERT INTO nutzer_geraet (nutzer_id, geraet_id, ip_hash, ip_typ, ip_land)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (nutzer_id, geraet_id) DO UPDATE SET zuletzt=now(), ip_hash=$3, ip_typ=$4`,
      [nutzerId, geraetId, ipHash, ipTyp, ipLand]),

  /* Proxy-/VPN-Pruefung: Ergebnis je IP-Hash, 24 Stunden gueltig */
  netzAusCache: (ip) =>
    eine(`SELECT typ, land FROM ip_netz WHERE ip_hash=$1 AND geprueft > now() - interval '24 hours'`, [hash(ip)]),
  netzMerken: (ip, typ, land) =>
    q(`INSERT INTO ip_netz (ip_hash, typ, land) VALUES ($1,$2,$3)
       ON CONFLICT (ip_hash) DO UPDATE SET typ=$2, land=$3, geprueft=now()`, [hash(ip), typ, land]),

  aufSperrliste: async (typ, wert) =>
    !!(await eine(`SELECT 1 FROM sperrliste WHERE typ=$1 AND wert=$2`, [typ, hash(wert)])),
  aufSperrlisteSetzen: (typ, wert, grund) =>
    q(`INSERT INTO sperrliste (typ, wert, grund) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [typ, hash(wert), grund]),

  /* ---------- Geld ---------- */

  transaktionExistiert: async (partner, tx) =>
    !!(await eine(`SELECT 1 FROM buchungen WHERE partner=$1 AND partner_tx=$2`, [partner, tx])),

  gutschreiben: ({ nutzerId, art, coins, titel, partner = null, partnerTx = null,
                   status = "haltefrist", halteStunden = HALTEFRIST_STD, risikoPunkte = null }) =>
    eine(`INSERT INTO buchungen (nutzer_id, art, coins, titel, partner, partner_tx, status, frei_ab, risiko_punkte)
          VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' hours')::interval, $9)
          ON CONFLICT DO NOTHING RETURNING *`,
      [nutzerId, art, coins, titel, partner, partnerTx, status, halteStunden, risikoPunkte]),

  stornieren: async (partner, tx) => {
    const b = await eine(`SELECT * FROM buchungen WHERE partner=$1 AND partner_tx=$2`, [partner, tx]);
    if (!b) return null;
    await q(`UPDATE buchungen SET status='storniert' WHERE id=$1`, [b.id]);
    // Ist das Geld schon frei, wird gegengebucht — das Guthaben darf ins Minus
    if (b.status === "frei")
      await db.gutschreiben({ nutzerId: b.nutzer_id, art: "storno", coins: -b.coins,
        titel: "Rückbuchung: " + b.titel, status: "frei", halteStunden: 0 });
    return b;
  },

  haltefristAufloesen: () =>
    q(`UPDATE buchungen SET status='frei' WHERE status='haltefrist' AND frei_ab < now()`),

  guthaben: async (nutzerId) =>
    (await eine(`SELECT * FROM guthaben WHERE nutzer_id=$1`, [nutzerId])) || { coins_gesamt: 0, coins_frei: 0 },

  freiesGuthabenEur: async (nutzerId) => {
    const g = await db.guthaben(nutzerId);
    return Number(g.coins_frei || 0) / 1000;
  },

  auszahlungAnlegen: ({ nutzerId, methode, ziel, betrag, gebuehr, status, risiko }) =>
    eine(`INSERT INTO auszahlungen (beleg_nr, nutzer_id, methode, ziel, ziel_hash, betrag_eur, gebuehr_eur, status, risiko_punkte)
          VALUES ('AZ-'||lpad((random()*899999+100000)::int::text,6,'0'),$1,$2,pgp_sym_encrypt($3,$9),$4,$5,$6,$7,$8) RETURNING *`,
      [nutzerId, methode, ziel, hash(ziel), betrag, gebuehr, status, risiko.punkte, ZIEL_SCHLUESSEL]),

  auszahlung: (id) => eine(`SELECT * FROM auszahlungen WHERE id=$1`, [id]),

  /** Einzige Stelle, die das Ziel entschluesselt — nur fuer senden() gedacht */
  auszahlungZiel: async (id) =>
    (await eine(`SELECT pgp_sym_decrypt(ziel, $2) AS ziel FROM auszahlungen WHERE id=$1`, [id, ZIEL_SCHLUESSEL]))?.ziel ?? null,

  /** Status nur aus 'laeuft' oder 'pruefung' heraus setzen — liefert null, wenn schon erledigt (kein Doppel-Refund) */
  auszahlungAbschliessen: ({ id, status, anbieterRef = null, bearbeiter = "system" }) =>
    eine(`UPDATE auszahlungen
             SET status=$2, anbieter_ref=COALESCE($3, anbieter_ref), bearbeiter=$4,
                 erledigt = CASE WHEN $2 IN ('ausgezahlt','abgelehnt') THEN now() END
           WHERE id=$1 AND status IN ('laeuft','pruefung') RETURNING *`, [id, status, anbieterRef, bearbeiter]),

  /** Laufende Auszahlungen mit Referenz beim Anbieter, die noch ein Endergebnis brauchen */
  auszahlungenOffen: async () =>
    (await q(`SELECT * FROM auszahlungen WHERE status='laeuft' AND anbieter_ref IS NOT NULL
               AND erstellt > now() - interval '30 days' ORDER BY erstellt`)).rows,

  ausgezahltImMonat: async (nutzerId) => {
    const r = await eine(
      `SELECT COALESCE(SUM(betrag_eur),0) s FROM auszahlungen
        WHERE nutzer_id=$1 AND status IN ('laeuft','ausgezahlt') AND erstellt > date_trunc('month', now())`,
      [nutzerId]);
    return Number(r.s);
  },

  ausgezahltHeute: async (nutzerId) => {
    const r = await eine(
      `SELECT COALESCE(SUM(betrag_eur),0) s FROM auszahlungen
        WHERE nutzer_id=$1 AND status IN ('laeuft','ausgezahlt','pruefung') AND erstellt > date_trunc('day', now())`,
      [nutzerId]);
    return Number(r.s);   // 'pruefung' zaehlt mit, sonst umgeht man das Tageslimit ueber viele Anfragen
  },

  /* ---------- Verhalten ---------- */

  aufgabeGestartet: ({ nutzerId, partner, angebot, erwarteteDauerSek }) =>
    q(`INSERT INTO aufgaben_starts (nutzer_id, partner, angebot, erwartete_dauer_sek) VALUES ($1,$2,$3,$4)`,
      [nutzerId, partner, angebot, erwarteteDauerSek]),

  /**
   * Verhaltens-Kennzahlen aus Aufgabenstarts und Abschluessen.
   * Dauer = Abschluss (Buchung) minus letzter Start desselben Nutzers beim selben Partner (max. 24 h davor).
   * Erwartete Dauer: was andere Nutzer fuer dieselben Angebote brauchen (ab 5 Messungen),
   * sonst der beim Start gemeldete Wert, sonst 999 (= unauffaellig).
   */
  verhaltenFuer: async (nutzerId) => {
    const v = await eine(`
      WITH meine AS (
        SELECT b.erstellt, b.coins, s.gestartet, s.angebot, s.erwartete_dauer_sek,
               EXTRACT(epoch FROM b.erstellt - s.gestartet) AS dauer
          FROM buchungen b
          LEFT JOIN LATERAL (
            SELECT gestartet, angebot, erwartete_dauer_sek FROM aufgaben_starts s
             WHERE s.nutzer_id = b.nutzer_id AND s.partner = b.partner
               AND s.gestartet <= b.erstellt AND s.gestartet > b.erstellt - interval '24 hours'
             ORDER BY s.gestartet DESC LIMIT 1) s ON TRUE
         WHERE b.nutzer_id = $1 AND b.art = 'aufgabe'
         ORDER BY b.erstellt DESC LIMIT 20
      ),
      andere AS (
        SELECT EXTRACT(epoch FROM b.erstellt - s.gestartet) AS dauer
          FROM buchungen b
          JOIN LATERAL (
            SELECT gestartet, angebot FROM aufgaben_starts s
             WHERE s.nutzer_id = b.nutzer_id AND s.partner = b.partner
               AND s.gestartet <= b.erstellt AND s.gestartet > b.erstellt - interval '24 hours'
             ORDER BY s.gestartet DESC LIMIT 1) s ON TRUE
         WHERE b.nutzer_id <> $1 AND b.art = 'aufgabe' AND b.erstellt > now() - interval '30 days'
           AND s.angebot IN (SELECT angebot FROM meine WHERE angebot IS NOT NULL)
      ),
      abstaende AS (
        SELECT EXTRACT(epoch FROM erstellt - lag(erstellt) OVER (ORDER BY erstellt)) AS gap
          FROM (SELECT erstellt FROM buchungen WHERE nutzer_id = $1 AND art = 'aufgabe'
                 ORDER BY erstellt DESC LIMIT 12) x
      ),
      ereignisse AS (
        SELECT erstellt AS t FROM buchungen WHERE nutzer_id = $1 AND erstellt > now() - interval '7 days'
        UNION ALL
        SELECT gestartet FROM aufgaben_starts WHERE nutzer_id = $1 AND gestartet > now() - interval '7 days'
      ),
      sitzungen AS (
        SELECT t, SUM(neu) OVER (ORDER BY t) AS nr FROM (
          SELECT t, CASE WHEN lag(t) OVER (ORDER BY t) IS NULL
                           OR t - lag(t) OVER (ORDER BY t) > interval '30 minutes' THEN 1 ELSE 0 END AS neu
            FROM ereignisse) y
      ),
      schwelle AS (
        SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY coins) AS p75, COUNT(*) AS n
          FROM buchungen WHERE art = 'aufgabe' AND erstellt > now() - interval '30 days'
      )
      SELECT
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dauer) FROM meine WHERE dauer IS NOT NULL) AS median_dauer,
        (SELECT COUNT(*) FROM meine WHERE dauer IS NOT NULL)                                        AS n_dauer,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dauer) FROM andere)                     AS erwartet_andere,
        (SELECT COUNT(*) FROM andere)                                                               AS n_andere,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY erwartete_dauer_sek) FROM meine
          WHERE erwartete_dauer_sek IS NOT NULL)                                                    AS erwartet_gemeldet,
        (SELECT COUNT(*) FROM abstaende WHERE gap IS NOT NULL)                                      AS n_gaps,
        (SELECT stddev_pop(gap) / NULLIF(avg(gap), 0) FROM abstaende WHERE gap IS NOT NULL)         AS gap_cv,
        (SELECT avg(gap) FROM abstaende WHERE gap IS NOT NULL)                                      AS gap_avg,
        (SELECT COALESCE(MAX(h), 0) FROM
          (SELECT EXTRACT(epoch FROM max(t) - min(t)) / 3600 AS h FROM sitzungen GROUP BY nr) z)   AS stunden_am_stueck,
        (SELECT CASE WHEN (SELECT n FROM schwelle) < 20 THEN 0
                     ELSE COUNT(*) FILTER (WHERE coins >= (SELECT p75 FROM schwelle))::float / GREATEST(COUNT(*), 1) END
           FROM meine)                                                                              AS anteil_high_payout
      `, [nutzerId]);

    const genugMessungen = Number(v.n_dauer) >= 3;          // unter 3 Messungen kein Urteil
    const erwartet = Number(v.n_andere) >= 5 ? Number(v.erwartet_andere)
                   : v.erwartet_gemeldet != null ? Number(v.erwartet_gemeldet) : 999;
    return {
      medianDauerSek: genugMessungen ? Math.round(Number(v.median_dauer)) : 999,
      erwarteteDauerSek: genugMessungen ? Math.round(erwartet) : 999,
      gleicheAbstaende: Number(v.n_gaps) >= 5 && Number(v.gap_cv) < 0.05 && Number(v.gap_avg) < 3600,
      stundenAmStueck: Number(v.stunden_am_stueck || 0),
      anteilHighPayout: Number(v.anteil_high_payout || 0),
    };
  },

  /* ---------- Kennzahlen für die Betrugserkennung ---------- */

  /** `ziel` = das gerade angefragte Auszahlungsziel, damit Mehrfachkonto- und Sperrlisten-Pruefung es schon sehen */
  kennzahlenFuer: async (nutzerId, { ziel = null } = {}) => {
    const zielHash = ziel == null ? null : hash(ziel);
    const k = await eine(`
      WITH g AS (SELECT geraet_id, ip_hash FROM nutzer_geraet WHERE nutzer_id=$1)
      SELECT
        (SELECT COUNT(DISTINCT nutzer_id) FROM nutzer_geraet
          WHERE geraet_id IN (SELECT geraet_id FROM g))                         AS konten_auf_geraet,
        (SELECT COUNT(DISTINCT nutzer_id) FROM nutzer_geraet
          WHERE ip_hash IN (SELECT ip_hash FROM g))                             AS konten_auf_ip,
        (SELECT bool_or(emulator OR root_jailbreak) FROM geraete
          WHERE id IN (SELECT geraet_id FROM g))                                AS emulator,
        (SELECT bool_or(gesperrt) FROM geraete WHERE id IN (SELECT geraet_id FROM g)) AS geraet_gesperrt,
        (SELECT max(ip_typ) FROM nutzer_geraet WHERE nutzer_id=$1)              AS ip_typ,
        (SELECT EXTRACT(day FROM now()-min(erstmals)) FROM geraete
          WHERE id IN (SELECT geraet_id FROM g))                                AS geraet_alter_tage,
        (SELECT EXTRACT(day FROM now()-erstellt) FROM nutzer WHERE id=$1)       AS konto_alter_tage,
        (SELECT COUNT(*) FROM buchungen WHERE nutzer_id=$1 AND art='aufgabe')   AS abschluesse,
        (SELECT COALESCE(SUM(coins),0)/1000.0 FROM buchungen
          WHERE nutzer_id=$1 AND coins>0 AND art IN ('aufgabe','bonus','werbung')) AS verdient_eur,
        (SELECT COUNT(*)::float / GREATEST(COUNT(*) FILTER (WHERE status<>'storniert'),1)
           FROM buchungen WHERE nutzer_id=$1 AND status='storniert')            AS storno_quote,
        (SELECT COUNT(DISTINCT a2.nutzer_id) FROM auszahlungen a1
           JOIN auszahlungen a2 ON a1.ziel_hash=a2.ziel_hash
          WHERE a1.nutzer_id=$1)                                                AS konten_gleiche_adresse,
        (SELECT COUNT(DISTINCT nutzer_id) FROM auszahlungen
          WHERE $2::text IS NOT NULL AND ziel_hash=$2 AND nutzer_id<>$1)         AS konten_gleiche_adresse_neu,
        (SELECT TRUE FROM sperrliste WHERE typ='auszahlziel' AND wert=$2)        AS ziel_gesperrt,
        (SELECT COUNT(*) FROM nutzer WHERE geworben_von=$1)                     AS refs,
        (SELECT COUNT(*) FROM nutzer w JOIN nutzer_geraet ng ON ng.nutzer_id=w.id
          WHERE w.geworben_von=$1 AND ng.geraet_id IN (SELECT geraet_id FROM g))AS refs_gleiches_geraet
      `, [nutzerId, zielHash]);
    const v = await db.verhaltenFuer(nutzerId);

    return {
      kontenAufGeraet: Number(k.konten_auf_geraet || 1),
      kontenAufIp: Number(k.konten_auf_ip || 1),
      emulator: !!k.emulator,
      geraetAufSperrliste: !!k.geraet_gesperrt,
      ipTyp: k.ip_typ || "unbekannt",
      geraetAlterTage: Number(k.geraet_alter_tage || 0),
      kontoAlterTage: Number(k.konto_alter_tage || 0),
      abschluesse: Number(k.abschluesse || 0),
      verdientEur: Number(k.verdient_eur || 0),
      stornoQuote: Number(k.storno_quote || 0),
      kontenMitGleicherAuszahladresse: Math.max(Number(k.konten_gleiche_adresse || 1), Number(k.konten_gleiche_adresse_neu || 0) + 1),
      refs: Number(k.refs || 0),
      refsGleichesGeraet: Number(k.refs_gleiches_geraet || 0),
      refsAktiv: 0,          // aus buchungen der Geworbenen nachziehen
      ...v,                  // medianDauerSek, erwarteteDauerSek, gleicheAbstaende, stundenAmStueck, anteilHighPayout
      auszahladresseGeaendertVorStd: 999,
      simLand: null, ipLand: null, alterAngabe: 99, ausweisSchonBenutzt: false,
      auszahladresseAufSperrliste: !!k.ziel_gesperrt,
    };
  },

  risikoMerken: ({ nutzerId, punkte, stufe, treffer, anlass }) =>
    q(`INSERT INTO risiko_verlauf (nutzer_id, punkte, stufe, treffer, anlass) VALUES ($1,$2,$3,$4,$5)`,
      [nutzerId, punkte, stufe, treffer, anlass]),

  protokoll: (nutzerId, aktion, details, wer = "system") =>
    q(`INSERT INTO protokoll (nutzer_id, aktion, details, wer) VALUES ($1,$2,$3,$4)`,
      [nutzerId, aktion, details, wer]),

  /** Verbindungen schliessen (Tests, sauberes Herunterfahren) */
  schliessen: () => pool.end(),

  codeFuer: (id) => id.slice(0, 6).toUpperCase(),
  nutzerZuCode: async (code) =>
    (await eine(`SELECT id FROM nutzer WHERE upper(left(id::text,6))=upper($1)`, [code]))?.id || null,
};

/* Haltefrist jede Minute auflösen */
setInterval(() => db.haltefristAufloesen().catch(() => {}), 60000).unref();
