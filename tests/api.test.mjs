import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {z} from 'zod';
function moduleFrom(path,dependencies={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw new Error(name);return dependencies[name]},loaded,loaded.exports);return loaded.exports;
}
test('API persists changes, isolated snapshots, plans and audit; rejects unauthorized and invalid requests',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'changeguard-test-')),'test.sqlite');
 let sqlite=new DatabaseSync(file);sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(readFileSync(new URL('../drizzle/0000_boring_bruce_banner.sql',import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},run(){return /^\s*SELECT/i.test(sql)?{results:sqlite.prepare(sql).all(...args)}:sqlite.prepare(sql).run(...args)}}},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.run());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 let user={userId:'owner',displayName:'Owner',email:'owner@example.test'};
 const engine=moduleFrom('../lib/engine.ts');
 const route=moduleFrom('../app/api/workspace/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>user},'@/lib/store':{database:()=>db},'@/lib/engine':engine,zod:{z}});
 const post=(body,origin='https://changeguard.test')=>route.POST(new Request('https://changeguard.test/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}));
 const get=(id='')=>route.GET(new Request('https://changeguard.test/api/workspace'+(id?'?changeId='+id:'')));
 assert.equal((await post({action:'create',title:'Decommission SERVER17',description:'Dependency assessment',assetId:'SERVER17'},'https://evil.test')).status,403);
 assert.equal((await post({action:'create',title:'x',description:'y',assetId:'INVALID'})).status,400);
 const response=await post({action:'create',title:'Decommission SERVER17',description:'Dependency assessment',assetId:'SERVER17'});assert.equal(response.status,201);const {id}=await response.json();
 assert.equal((await (await get()).json()).changes.length,1);
 assert.equal((await (await get(id)).json()).runs.length,0);
 const first=await post({action:'analyze',changeId:id});assert.equal(first.status,201);const run=await first.json();
 let snapshot=await (await get(id)).json();assert.equal(snapshot.runs[0].result.score,78);assert.equal(snapshot.findings.length,7);assert.equal(snapshot.findings.filter(f=>f.status==='unknown').length,1);
 const plan=await post({action:'plan',changeId:id,runId:run.id,owner:'Ops',window:'Saturday',constraints:'Keep backups'});assert.equal(plan.status,201);
 await post({action:'analyze',changeId:id});
 sqlite.close();sqlite=new DatabaseSync(file);sqlite.exec('PRAGMA foreign_keys=ON');
 snapshot=await (await get(id)).json();assert.equal(snapshot.runs.length,2);assert.equal(snapshot.plans.length,1);assert.equal(snapshot.plans[0].run_id,run.id);assert.equal(snapshot.plans[0].document.constraints,'Keep backups');assert.equal(snapshot.audit.length,4);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM findings').get().n,14);
 user={...user,userId:'other'};
 assert.equal((await (await get()).json()).changes.length,0);assert.equal((await get(id)).status,404);assert.equal((await post({action:'analyze',changeId:id})).status,404);
 assert.equal((await post({action:'plan',changeId:id,runId:run.id,owner:'Other',window:'Now',constraints:''})).status,404);
 user=null;assert.equal((await get()).status,401);assert.equal((await post({action:'analyze',changeId:id})).status,401);
 sqlite.close();
});
