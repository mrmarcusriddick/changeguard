import {readFile} from 'node:fs/promises';
import {migrateProduction} from './migrate.mjs';
process.env.CHANGEGUARD_COMMIT = (await readFile(new URL('./COMMIT',import.meta.url),'utf8')).trim();
process.env.HOSTNAME = '0.0.0.0';
console.info('ChangeGuard startup: connecting to PostgreSQL and applying migrations');
await migrateProduction();
console.info('ChangeGuard startup: migrations complete; starting HTTP server');
await import('./server.js');
