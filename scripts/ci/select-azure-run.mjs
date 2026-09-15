import {appendFileSync} from 'node:fs';
import {validateRun} from './release-policy.mjs';
const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.SOURCE_RUN_ID;
if (!/^\d+$/.test(runId ?? '')) throw new Error('Expected a numeric CI run ID');
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'}});
  if (!response.ok) throw new Error(`GitHub API failed (${response.status})`);
  return response.json();
}
const run = await api(`actions/runs/${runId}`);
validateRun(run,repo);
const compare = await api(`compare/${run.head_sha}...main`);
if (!['ahead','identical'].includes(compare.status)) throw new Error('Source commit is not on main');
const artifacts = (await api(`actions/runs/${runId}/artifacts?per_page=100`)).artifacts.filter(a=>a.name===`changeguard-azure-${run.head_sha}`&&!a.expired);
if (artifacts.length!==1) throw new Error('Expected one unexpired Azure artifact');
appendFileSync(process.env.GITHUB_OUTPUT,`sha=${run.head_sha}\nartifact_id=${artifacts[0].id}\nrun_id=${runId}\n`);
