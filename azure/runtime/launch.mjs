import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// App Service ZIP mounting need not preserve pnpm symlinks. The inner tar does.
const runtime = await mkdtemp(join(tmpdir(),'changeguard-runtime-'));
execFileSync('tar',['-xzf',fileURLToPath(new URL('./runtime.tar.gz',import.meta.url)),'-C',runtime],{stdio:'inherit'});
await import(pathToFileURL(join(runtime,'start.mjs')).href);
