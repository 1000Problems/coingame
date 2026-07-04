// Lazily-initialised tagged-template SQL client over Neon's serverless driver
// (botcity lib/db.ts pattern). Importing this module never throws at build
// time; the connection is only created on first query.
//
// SHARED DB RULE: every query in this repo touches ONLY stockgame_* tables.

import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let client: Sql | null = null;

function getClient(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

// Tagged template: sql`select * from stockgame_event where ref = ${ref}`
// Rows come back as objects (default neon config).
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> {
  const c = getClient() as unknown as (
    s: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Record<string, unknown>[]>;
  return c(strings, ...values);
}
