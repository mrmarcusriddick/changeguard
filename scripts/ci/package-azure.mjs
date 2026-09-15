import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function packageAzure(bundle) {
  bundle=resolve(bundle);
  const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(join(bundle,'COMMIT'),commit+'\n');
  // Archives must not contain links to build-machine files.
  function validate(directory) {
    for (const name of readdirSync(directory)) {
      const file=join(directory,name);
      const stat=lstatSync(file);
      if (stat.isSymbolicLink()) {
        if (!realpathSync(file).startsWith(bundle+sep)) throw new Error(`External runtime symlink: ${file}`);
      } else if (stat.isDirectory()) validate(file);
    }
  }
  validate(bundle);
  const delivery=mkdtempSync(resolve('.sites-runtime/azure-delivery-'));
  execFileSync('tar',['-czf',join(delivery,'runtime.tar.gz'),'-C',bundle,'.']);
  cpSync('azure/runtime/launch.mjs',join(delivery,'launch.mjs'));
  writeFileSync(join(delivery,'COMMIT'),commit+'\n');
  // Resolve runtime dependencies away from the checkout so Node cannot fall back to it.
  const verification=mkdtempSync(join(tmpdir(),'changeguard-package-test-'));
  execFileSync('tar',['-xzf',join(delivery,'runtime.tar.gz'),'-C',verification]);
  const migrationURL=pathToFileURL(join(verification,'migrate.mjs')).href;
  execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(migrationURL)});`],{cwd:verification,stdio:'inherit'});
  execFileSync(process.execPath,['--check',join(verification,'server.js')],{cwd:verification,stdio:'inherit'});
  mkdirSync('artifacts',{recursive:true});
  const output=resolve('artifacts/changeguard-azure.zip');
  if (existsSync(output)) throw new Error('Azure ZIP already exists; use a fresh output directory.');
  execFileSync('zip',['-q',output,'runtime.tar.gz','launch.mjs','COMMIT'],{cwd:delivery,stdio:'inherit'});
  execFileSync('sh',['-c','sha256sum changeguard-azure.zip > SHA256SUMS'],{cwd:resolve('artifacts'),stdio:'inherit'});
}
