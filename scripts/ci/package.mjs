import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root=process.cwd();
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git('status','--porcelain','--untracked-files=normal'))throw new Error('Commit source changes before packaging.');
const commit=git('rev-parse','--verify','HEAD');
const hosting=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
if(hosting.static||hosting.d1!=='DB'||!hosting.project_id)throw new Error('Expected the ChangeGuard Sites Worker and DB configuration.');
for(const required of ['dist/server/index.js','dist/client','drizzle/meta/_journal.json'])if(!existsSync(required))throw new Error(`Missing ${required}`);
// Fail rather than silently ship links, environment files or local state.
function inspect(dir){for(const name of readdirSync(dir)){const path=resolve(dir,name);const stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error(`Symlink in bundle: ${path}`);if(name.startsWith('.env')||['node_modules','.git','.wrangler'].includes(name))throw new Error(`Unexpected private file: ${path}`);if(stat.isDirectory())inspect(path);}}
inspect('dist/server');inspect('dist/client');
const out=resolve('artifacts');
if(existsSync(out)&&readdirSync(out).length)throw new Error('artifacts must be empty; preserve or move prior delivery first.');
mkdirSync(out,{recursive:true});
const stage=resolve('.sites-runtime/ci-package',commit);
if(existsSync(stage))throw new Error('Staging path already exists; use a clean checkout for a fresh package.');
mkdirSync(resolve(stage,'dist/.openai'),{recursive:true});
cpSync('dist/server',resolve(stage,'dist/server'),{recursive:true});
cpSync('dist/client',resolve(stage,'dist/client'),{recursive:true});
cpSync('drizzle',resolve(stage,'dist/.openai/drizzle'),{recursive:true});
cpSync('.openai/hosting.json',resolve(stage,'dist/.openai/hosting.json'));
execFileSync('tar',['-czf',resolve(out,'changeguard-sites.tar.gz'),'-C',stage,'dist']);
execFileSync('tar',['-tzf',resolve(out,'changeguard-sites.tar.gz')],{stdio:'ignore'});
execFileSync('git',['archive','--format=zip','--prefix=changeguard/',`--output=${resolve(out,'changeguard-source.zip')}`,commit]);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const migrationDir=resolve('drizzle');
const manifest={format:1,commit,repository:process.env.GITHUB_REPOSITORY||null,runId:process.env.GITHUB_RUN_ID||null,mode:'sites-handoff',node:process.version,packageManager:JSON.parse(readFileSync('package.json','utf8')).packageManager,lockfileSha256:hash('pnpm-lock.yaml'),migrations:readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort().map(n=>({path:relative(root,resolve(migrationDir,n)),sha256:hash(resolve(migrationDir,n))})),files:['changeguard-source.zip','changeguard-sites.tar.gz'].map(n=>({name:n,sha256:hash(resolve(out,n))}))};
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(resolve(out,'SHA256SUMS'),['changeguard-source.zip','changeguard-sites.tar.gz','manifest.json'].map(n=>`${hash(resolve(out,n))}  ${n}`).join('\n')+'\n');
console.log(`Packaged ${commit} into artifacts/`);

