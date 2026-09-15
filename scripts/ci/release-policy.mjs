import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function validateRun(run,repository) {
 if(run.repository?.full_name!==repository||run.head_repository?.full_name!==repository)throw new Error('Wrong repository');
 if(run.path!=='.github/workflows/ci.yml'||run.event!=='push'||run.head_branch!=='main')throw new Error('Only main push CI builds can be released');
 if(run.status!=='completed'||run.conclusion!=='success')throw new Error('Build is not successful');
 if(!/^[0-9a-f]{40}$/.test(run.head_sha))throw new Error('Invalid source SHA');
 return run.head_sha;
}
export function validateInputs(runId,tag){if(!/^[1-9][0-9]*$/.test(runId||''))throw new Error('Invalid run ID');if(!/^v\d+\.\d+\.\d+$/.test(tag||''))throw new Error('Use a release tag such as v0.2.0');}
async function main(){
 const {GITHUB_REPOSITORY:repo,GH_TOKEN:token,RELEASE_RUN_ID:runId,RELEASE_TAG:tag,GITHUB_OUTPUT:output}=process.env;
 validateInputs(runId,tag);if(!repo||!token||!output)throw new Error('Missing workflow context');
 const request=async(path,allow404=false)=>{const r=await fetch(`https://api.github.com/repos/${repo}/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});if(allow404&&r.status===404)return null;if(!r.ok)throw new Error(`GitHub request failed: ${r.status}`);return r.json();};
 const run=await request(`actions/runs/${runId}`);const sha=validateRun(run,repo);
 const comparison=await request(`compare/${sha}...main`);if(!['ahead','identical'].includes(comparison.status))throw new Error('Commit is no longer on main');
 if(await request(`git/ref/tags/${tag}`,true))throw new Error('Tag exists; releases cannot overwrite versions');
 if(await request(`releases/tags/${tag}`,true))throw new Error('Release exists');
 const data=await request(`actions/runs/${runId}/artifacts?per_page=100`);
 const artifacts=data.artifacts.filter(a=>a.name===`changeguard-${sha}`&&!a.expired);
 if(artifacts.length!==1)throw new Error('Expected exactly one unexpired delivery artifact');
 appendFileSync(output,`sha=${sha}\nartifact_id=${artifacts[0].id}\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();

