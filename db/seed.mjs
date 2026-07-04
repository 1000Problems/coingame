// Runs db/seed.sql against DATABASE_URL (env or .env.local). Idempotent.
import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DATABASE_URL not set (env or .env.local)");
}

const text = readFileSync(new URL("./seed.sql", import.meta.url), "utf8");
if (/\b(insert\s+into|update|delete\s+from)\s+(?!coingame_)[a-z_"]/i.test(text)) {
  console.error("REFUSING TO RUN: seed.sql writes outside coingame_ tables");
  process.exit(1);
}
const sql = neon(loadDatabaseUrl());
await sql(text);
console.log("seeded coingame_ticker.");
