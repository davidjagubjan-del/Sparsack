/**
 * Laeuft vor jeder Testdatei, bevor server.js importiert wird.
 * Werte aus .env werden geladen, Test-Werte ueberschreiben sie gezielt.
 */
import "dotenv/config";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://coincurb:coincurb@localhost:5432/coincurb_test";
process.env.JWT_SECRET = "test-jwt-secret-test-jwt-secret-test-jwt-secret";
process.env.HASH_PEPPER = "test-pepper-test-pepper-test-pepper-test-pepper";
process.env.APP_URL = "https://app.coincurb.test";
process.env.CORS_ORIGINS = "";
process.env.POSTBACK_BASIS = "https://api.coincurb.test";
process.env.USD_EUR = process.env.USD_EUR_TEST || "1";   // 1:1, damit Coin-Erwartungen lesbar bleiben

process.env.ADGATE_SECRET = "adgate-test-secret";
process.env.ADGATE_IPS = "";                       // Standard-Allowlist fuer Postback-Tests abschalten
process.env.AYET_SECRET = "ayet-test-secret";
process.env.AYET_IPS = "";
process.env.TOROX_SECRET = "torox-test-secret";
process.env.TOROX_IPS = "203.0.113.0/24,2001:db8::/32";
process.env.LOOTABLY_SECRET = "lootably-test-secret";
process.env.LOOTABLY_IPS = "";
process.env.BITLABS_SECRET = "bitlabs-test-secret";
process.env.BITLABS_IPS = "";
process.env.CPX_SECRET = "cpx-test-secret";
process.env.CPX_IPS = "";

process.env.AUSZAHLUNG_AKTIV = "paypal,amazon,steam";
process.env.ZIEL_SCHLUESSEL = "test-ziel-schluessel-test-ziel-schluessel-1234";
process.env.PAYPAL_UMGEBUNG = "sandbox";
process.env.PAYPAL_CLIENT_ID = "pp-client";
process.env.PAYPAL_SECRET = "pp-secret";
process.env.TANGO_UMGEBUNG = "sandbox";
process.env.TANGO_PLATFORM = "coincurb-test";
process.env.TANGO_KEY = "tango-key";
process.env.TANGO_ACCOUNT = "konto-1";
process.env.TANGO_CUSTOMER = "kunde-1";
process.env.TANGO_UTID_AMAZON = "U-AMAZON-DE";
process.env.TANGO_UTID_STEAM = "U-STEAM-EUR";

process.env.RESEND_KEY = "re_test";
process.env.MAIL_ABSENDER = "CoinCurb <no-reply@coincurb.test>";
process.env.TWILIO_SID = "ACtest";
process.env.TWILIO_TOKEN = "twilio-token";
process.env.TWILIO_VERIFY_SID = "VAtest";
process.env.APPLE_BUNDLE_ID = "app.coincurb.ios,app.coincurb.web";
