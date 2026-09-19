import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical,comparePolicies} from '../azure/monitor/policies.ts';
import {collectPolicies} from '../azure/monitor/graph.ts';
import {canMonitor,monitoredTenant} from '../azure/monitor/service.ts';
const policy={id:'policy-1',displayName:'Require MFA',state:'enabled',conditions:{users:{includeUsers:['All'],excludeGroups:[]}},grantControls:{operator:'AND',builtInControls:['mfa','compliantDevice']}};
const env={IDENTITY_ENDPOINT:'http://127.0.0.1/token',IDENTITY_HEADER:'test-only'};
const reply=data=>Response.json(data);
test('canonical ordering and metadata do not generate changes',()=>{
 const reordered=structuredClone(policy);reordered.grantControls.builtInControls.reverse();reordered.modifiedDateTime='today';
 assert.deepEqual(comparePolicies([policy],[reordered]),[]);
 assert.deepEqual(canonical({b:1,a:2}),{a:2,b:1});
});
test('detect exclusions, enforcement changes, deletion and additions with before/after',()=>{
 const changed=structuredClone(policy);changed.conditions.users.excludeGroups=['contractors'];
 const [finding]=comparePolicies([policy],[changed]);assert.equal(finding.severity,'high');assert.equal(finding.differences[0].path,'/conditions/users/excludeGroups');assert.deepEqual(finding.differences[0].before,[]);
 assert.equal(comparePolicies([policy],[{...policy,state:'disabled'}])[0].severity,'high');
 assert.equal(comparePolicies([policy],[])[0].kind,'deleted');
 assert.equal(comparePolicies([],[policy])[0].kind,'created');
 assert.equal(comparePolicies([policy],[{...policy,displayName:'New name'}])[0].severity,'low');
});
test('complete Graph pagination uses only read requests and keeps tokens server-side',async()=>{
 const calls=[];const pages=[{access_token:'test-token'},{value:[policy],'@odata.nextLink':'https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$skip=1'},{value:[{...policy,id:'policy-2'}]}];
 const result=await collectPolicies(async(url,init)=>{calls.push({url:String(url),init});return reply(pages.shift());},env);
 assert.equal(result.length,2);assert.equal(calls.length,3);assert(calls.every(c=>!c.init.method||c.init.method==='GET'));assert(calls.every(c=>c.init.redirect==='error'));assert.equal(calls[1].init.headers.Authorization,'Bearer test-token');
});
test('denied, throttled, malformed and partial collections fail instead of returning empty policies',async()=>{
 for(const status of [403,429,500]){let n=0;await assert.rejects(collectPolicies(async()=>++n===1?reply({access_token:'t'}):new Response('',{status}),env));}
 for(const data of [{},{value:[{id:'incomplete'}]},{value:[policy],'@odata.nextLink':'https://evil.example/steal'},{value:[policy,policy]}]){let n=0;await assert.rejects(collectPolicies(async()=>++n===1?reply({access_token:'t'}):reply(data),env));}
 let n=0;await assert.rejects(collectPolicies(async()=>{n++;if(n===1)return reply({access_token:'t'});if(n===2)return reply({value:[policy],'@odata.nextLink':'https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$skip=1'});return new Response('',{status:500});},env));
});
test('monitoring access is restricted to configured operators in the deployment tenant',()=>{
 const e={AZURE_TENANT_ID:monitoredTenant,CG_ENTRA_OPERATOR_IDS:'operator'};
 assert.equal(canMonitor(`${monitoredTenant}:operator`,e),true);assert.equal(canMonitor('other:operator',e),false);assert.equal(canMonitor(`${monitoredTenant}:viewer`,e),false);assert.equal(canMonitor(`${monitoredTenant}:operator`,{}),false);
});

test('monitor API enforces sign-in, operator access, origin and action before collection',async()=>{
 const {default:ts}=await import('typescript');const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../azure/monitor/route.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let user=null,calls=0;const loaded={exports:{}};
 const dependencies={'@/app/chatgpt-auth':{getChatGPTUser:async()=>user},'./service.ts':{canMonitor:id=>id==='operator',scan:async()=>{calls++;return {id:'scan'};},history:async()=>({scans:[]})},'./graph.ts':await import('../azure/monitor/graph.ts')};
 new Function('require','module','exports',code)(name=>dependencies[name],loaded,loaded.exports);
 const route=loaded.exports;const original=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://changeguard.test';
 const post=(body='{"action":"scan"}',origin='https://changeguard.test')=>route.POST(new Request('https://changeguard.test/api/entra',{method:'POST',headers:{origin,'content-type':'application/json'},body}));
 try{
  assert.equal((await post()).status,401);user={userId:'viewer'};assert.equal((await post()).status,403);
  assert.equal((await route.GET(new Request('https://changeguard.test/api/entra'))).status,403);
  user={userId:'operator'};assert.equal((await post(undefined,'https://evil.test')).status,403);assert.equal((await post('{"action":"delete"}')).status,400);assert.equal((await post('bad json')).status,400);assert.equal(calls,0);
  assert.equal((await post()).status,201);assert.equal(calls,1);
 }finally{if(original===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=original;}
});
