import pg from 'pg';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function migrate(client, directory) {
  await client.query('SELECT pg_advisory_lock(72004201)');
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)');
    for (const name of (await readdir(directory)).filter(n => /^\d+[-\w]*\.sql$/.test(n)).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Previously applied migration changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations VALUES ($1,$2)', [name,checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(72004201)'); }
}
export async function migrateProduction() {
  const client = new pg.Client({ssl: {rejectUnauthorized:true}, connectionTimeoutMillis:10000});
  try {
    await client.connect();
  } catch (error) {
    // Diagnose connectivity without logging credentials or the connection string.
    console.error('PostgreSQL connection failed:', error.code || 'CONNECTION_TIMEOUT_OR_FAILURE');
    const {lookup} = await import('node:dns/promises');
    const {createConnection} = await import('node:net');
    const host = process.env.PGHOST;
    const port = Number(process.env.PGPORT || 5432);
    if (host) {
      let timer;
      try {
        const addresses = await Promise.race([
          lookup(host, {all:true}),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000); }),
        ]);
        console.error('PostgreSQL DNS:', JSON.stringify(addresses));
      } catch (dnsError) {
        console.error('PostgreSQL DNS failed:', dnsError.code || 'DNS_TIMEOUT');
      } finally { clearTimeout(timer); }
      await new Promise(resolve => {
        const socket = createConnection({host, port, timeout:5000});
        const finish = result => { console.error('PostgreSQL TCP:', result); socket.destroy(); resolve(); };
        socket.once('connect', () => finish('CONNECTED'));
        socket.once('timeout', () => finish('TIMEOUT'));
        socket.once('error', tcpError => finish(tcpError.code || 'FAILED'));
      });
    }
    await client.end().catch(() => {});
    throw error;
  }
  try { await migrate(client, new URL('./migrations/',import.meta.url)); }
  finally { await client.end(); }
}
