import {readFile} from 'node:fs/promises';
import {migrateProduction} from './migrate.mjs';
process.env.CHANGEGUARD_COMMIT = (await readFile(new URL('./COMMIT',import.meta.url),'utf8')).trim();
process.env.HOSTNAME = '0.0.0.0';
await migrateProduction();
await import('./server.js');
