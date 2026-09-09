/** Test-Datenbank einmal pro Lauf leeren und schema.sql einspielen. */
import "dotenv/config";
import { readFileSync } from "fs";
import pg from "pg";

export default async function () {
  const url = process.env.TEST_DATABASE_URL || "postgres://coincurb:coincurb@localhost:5432/coincurb_test";
  if (!/_test\b/.test(new URL(url).pathname))
    throw new Error("TEST_DATABASE_URL muss auf eine Datenbank zeigen, deren Name auf _test endet.");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  } finally {
    await c.end();
  }
}
