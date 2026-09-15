import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRun,validateInputs} from '../scripts/ci/release-policy.mjs';
const repo='mrmarcusriddick/changeguard';
const trusted={repository:{full_name:repo},head_repository:{full_name:repo},path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:'a'.repeat(40),status:'completed',conclusion:'success'};
test('release accepts a successful main push from the expected workflow',()=>assert.equal(validateRun(trusted,repo),trusted.head_sha));
test('release rejects PR, fork, failed, incomplete and wrong-workflow builds',()=>{
 for(const patch of [{event:'pull_request'},{head_branch:'feature'},{head_repository:{full_name:'attacker/fork'}},{conclusion:'failure'},{status:'in_progress'},{path:'.github/workflows/other.yml'},{head_sha:'bad'}])assert.throws(()=>validateRun({...trusted,...patch},repo));
});
test('release identifiers reject shell syntax, paths and malformed values',()=>{validateInputs('123','v0.2.0');for(const [run,tag] of [['1;false','v0.2.0'],['123','../x'],['123','v1'],['-1','v0.2.0']])assert.throws(()=>validateInputs(run,tag));});

