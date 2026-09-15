import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ts from 'typescript';
import {z} from 'zod';
import {readFileSync} from 'node:fs';
import {parsePrincipal} from '../azure/runtime/principal.ts';
import {createDatabase, postgresOptions} from '../azure/runtime/store.ts';
import {migrate} from '../azure/runtime/migrate.mjs';

test('Entra principal requires configured tenant and stable object ID',()=>{
  const tenant='a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2';
  const oid='21f906e3-78aa-44c6-a1b5-a10d15caa035';
  const encode=claims=>Buffer.from(JSON.stringify({auth_typ:'aad',claims})).toString('base64');
  const claims=[{typ:'tid',val:tenant},{typ:'oid',val:oid},{typ:'name',val:'Marcus'}];
  assert.equal(parsePrincipal(encode(claims),tenant).userId,`${tenant}:${oid}`);
  assert.equal(parsePrincipal(encode(claims),'another-tenant'),null);
  assert.equal(parsePrincipal(encode(claims),undefined),null);
  assert.equal(parsePrincipal(encode([{typ:'tid',val:tenant}]),tenant),null);
  assert.equal(parsePrincipal(encode([...claims,{typ:'tid',val:'other'}]),tenant),null);
  assert.equal(parsePrincipal('malformed',tenant),null);
  assert.equal(parsePrincipal(null,tenant),null);
});

function moduleFrom(path,dependencies={}) {
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw new Error(name);return dependencies[name]},loaded,loaded.exports);
  return loaded.exports;
}
test('PostgreSQL migrations, full API flow, tenant isolation, and atomic rollback',async()=>{
  if (!process.env.PGHOST || !process.env.PGDATABASE?.endsWith('_test')) throw new Error('Set PGHOST and a disposable PGDATABASE ending in _test');
  const pool=new pg.Pool(postgresOptions());
  try {
    const client=await pool.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
      await migrate(client,new URL('../azure/migrations/',import.meta.url));
      await migrate(client,new URL('../azure/migrations/',import.meta.url));
      assert.equal((await client.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,1);
    } finally {client.release();}
    const db=createDatabase(pool);
    let user={userId:'tenant-a:owner',displayName:'Owner'};
    const route=moduleFrom('../app/api/workspace/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>user},'@/lib/store':{database:()=>db},'@/lib/engine':moduleFrom('../lib/engine.ts'),zod:{z}});
    const post=body=>route.POST(new Request('https://changeguard.test/api/workspace',{method:'POST',headers:{'content-type':'application/json',origin:'https://changeguard.test'},body:JSON.stringify(body)}));
    const get=id=>route.GET(new Request('https://changeguard.test/api/workspace'+(id?'?changeId='+id:'')));
    const created=await post({action:'create',title:'Retire server',description:'Check dependencies first',assetId:'SERVER17'});
    assert.equal(created.status,201);
    const {id}=await created.json();
    const analysis=await post({action:'analyze',changeId:id});
    assert.equal(analysis.status,201);
    const {id:runId}=await analysis.json();
    assert.equal((await post({action:'plan',changeId:id,runId,owner:'Ops',window:'Saturday',constraints:''})).status,201);
    const detail=await (await get(id)).json();
    assert.equal(detail.findings.length,7);
    assert.equal(detail.runs[0].result.score,78);
    assert.equal(detail.plans.length,1);
    assert.equal(detail.audit.length,3);
    // A failing second statement must roll back the first statement in a batch.
    await assert.rejects(db.batch([db.prepare('INSERT INTO assets VALUES (?,?,?)').bind('rollback','name','detail'),db.prepare('INSERT INTO assets VALUES (?,?,?)').bind('rollback','duplicate','detail')]));
    assert.equal(await db.prepare('SELECT id FROM assets WHERE id=?').bind('rollback').first(),null);
    user={userId:'tenant-b:owner',displayName:'Other'};
    assert.equal((await get(id)).status,404);
    assert.equal((await post({action:'analyze',changeId:id})).status,404);
    assert.equal((await (await get()).json()).changes.length,0);
    user=null;
    assert.equal((await get()).status,401);
    await pool.query("UPDATE schema_migrations SET checksum='tampered'");
    const migrationClient=await pool.connect();
    try {await assert.rejects(migrate(migrationClient,new URL('../azure/migrations/',import.meta.url)),/Previously applied migration changed/);}
    finally {migrationClient.release();}
  } finally {await pool.end();}
});
