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

process.env.ADGATE_SECRET = "adgate-test-secret";
process.env.ADGATE_IPS = "";                       // Standard-Allowlist fuer Postback-Tests abschalten
process.env.TOROX_SECRET = "torox-test-secret";
process.env.TOROX_IPS = "203.0.113.0/24,2001:db8::/32";
process.env.CPX_SECRET = "cpx-test-secret";
process.env.CPX_IPS = "";
process.env.AYET_SECRET = "ayet-test-secret";

process.env.AUSZAHLUNG_AKTIV = "paypal,amazon";
