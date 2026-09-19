import {cpSync, mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageAzure} from './package-azure.mjs';

const stage = resolve('.sites-runtime/azure-build');
if (existsSync(stage)) throw new Error('Azure build directory already exists; remove it before a fresh build.');
mkdirSync(stage,{recursive:true});
for (const item of ['app','components','hooks','lib','public','vendor','package.json','pnpm-lock.yaml','postcss.config.mjs','tsconfig.json']) cpSync(item, resolve(stage,item),{recursive:true});
// Copy resolved dependencies (no symlinks outside the build root in the deployment).
cpSync('node_modules',resolve(stage,'node_modules'),{recursive:true,verbatimSymlinks:true});
cpSync('azure/runtime/store.ts',resolve(stage,'lib/store.ts'));
cpSync('azure/runtime/auth.ts',resolve(stage,'app/chatgpt-auth.ts'));
cpSync('azure/runtime/principal.ts',resolve(stage,'app/principal.ts'));
mkdirSync(resolve(stage,'app/api/health'),{recursive:true});
cpSync('azure/runtime/health.ts',resolve(stage,'app/api/health/route.ts'));
writeFileSync(resolve(stage,'app/page.tsx'),readFileSync('app/page.tsx','utf8').replace('/signin-with-chatgpt?return_to=/', '/.auth/login/aad?post_login_redirect_uri=/'));
// Azure-only monitoring uses managed identity and PostgreSQL, never the Sites runtime.
cpSync('azure/monitor',resolve(stage,'azure/monitor'),{recursive:true});
mkdirSync(resolve(stage,'azure/runtime'),{recursive:true});
cpSync('azure/runtime/store.ts',resolve(stage,'azure/runtime/store.ts'));
mkdirSync(resolve(stage,'app/api/entra'),{recursive:true});
writeFileSync(resolve(stage,'app/api/entra/route.ts'),readFileSync('azure/monitor/route.ts','utf8').replace("'./service.ts'", "'@/azure/monitor/service'").replace("'./graph.ts'", "'@/azure/monitor/graph'"));
mkdirSync(resolve(stage,'app/entra'),{recursive:true});
writeFileSync(resolve(stage,'app/entra/page.tsx'), "export {default} from '@/azure/monitor/page';\n");
writeFileSync(resolve(stage,'app/page.tsx'),readFileSync(resolve(stage,'app/page.tsx'),'utf8').replace('<span>{user}</span>', '<a href="/entra">Entra monitoring</a><span>{user}</span>'));
// Trust a configured public origin instead of Next's internal reverse-proxy URL.
writeFileSync(resolve(stage,'app/api/workspace/route.ts'),readFileSync('app/api/workspace/route.ts','utf8').replace('origin!==new URL(request.url).origin','origin!==process.env.APP_ORIGIN'));
writeFileSync(resolve(stage,'next.config.mjs'), 'export default {output:"standalone", outputFileTracingRoot:process.cwd(), serverExternalPackages:["pg"]};\n');
const tsconfig = JSON.parse(readFileSync('tsconfig.json','utf8'));
tsconfig.exclude = ['node_modules'];
writeFileSync(resolve(stage,'tsconfig.json'),JSON.stringify(tsconfig,null,2));
execFileSync(process.execPath,[resolve(stage,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:stage,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
const bundle = resolve(stage,'.next/standalone');
cpSync(resolve(stage,'.next/static'),resolve(bundle,'.next/static'),{recursive:true});
cpSync('public',resolve(bundle,'public'),{recursive:true});
for (const file of ['start.mjs','migrate.mjs']) cpSync(`azure/runtime/${file}`,resolve(bundle,file));
cpSync('azure/migrations',resolve(bundle,'migrations'),{recursive:true});
// pg is also imported by the startup migrator outside the Next dependency trace.
// Next traces pg from the API; fail if packaging ever omits it.
if (!existsSync(resolve(bundle,'node_modules/pg'))) throw new Error('pg absent from standalone trace');
packageAzure(bundle);
