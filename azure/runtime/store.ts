import pg from "pg";

export function postgresOptions() {
  // Explicit settings avoid connection-string sslmode overrides of certificate validation.
  return {
    host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
    ssl: process.env.NODE_ENV === "test" ? false : { rejectUnauthorized: true },
    max: 5, connectionTimeoutMillis: 10000, statement_timeout: 15000,
  };
}

// Only application-owned SQL is accepted here. Values always use protocol parameters.
export function postgresSQL(sql: string) {
  let index = 0;
  let result = sql.replace(/\?/g, () => `$${++index}`);
  if (result.startsWith("INSERT OR IGNORE INTO ")) result = result.replace("INSERT OR IGNORE INTO ", "INSERT INTO ") + " ON CONFLICT DO NOTHING";
  return result;
}
class Statement {
  values: unknown[] = [];
  readonly sql: string;
  readonly pool: pg.Pool;
  constructor(sql: string, pool: pg.Pool) { this.sql = sql; this.pool = pool; }
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T = Record<string, unknown>>() { const r = await this.pool.query(this.sql, this.values); return {results: r.rows as T[]}; }
  async first<T = Record<string, unknown>>() { return (await this.all<T>()).results[0] ?? null; }
}
export function createDatabase(pool: pg.Pool) {
  return {
    prepare(sql: string) { return new Statement(postgresSQL(sql), pool); },
    async batch(statements: Statement[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results = [];
        for (const statement of statements) results.push({results: (await client.query(statement.sql, statement.values)).rows});
        await client.query("COMMIT");
        return results;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
}
let store: ReturnType<typeof createDatabase> | undefined;
export function database() {
  if (!store) {
    if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER || !process.env.PGPASSWORD) throw new Error("Database settings are missing");
    store = createDatabase(new pg.Pool(postgresOptions()));
  }
  return store;
}
