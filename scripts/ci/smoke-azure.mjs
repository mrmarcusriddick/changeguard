const [origin, commit] = process.argv.slice(2);
if (!/^https:\/\/[a-z0-9-]+\.azurewebsites\.net$/.test(origin??'') || !/^[a-f0-9]{40}$/.test(commit??'')) throw new Error('Invalid deployment target');
// Retry startup/migration delays, but never promote a redirect or old release as healthy.
let healthy = false;
for (let attempt=0;attempt<30;attempt++) {
  try {
    const response = await fetch(`${origin}/api/health`,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    if (response.status===200) {
      const body = await response.json();
      if (body.status==='ok' && body.commit===commit) { healthy=true; break; }
    }
  } catch { /* retry bounded startup delay */ }
  await new Promise(resolve=>setTimeout(resolve,10000));
}
if (!healthy) throw new Error('Deployment failed database/release health check');
const forged = {auth_typ:'aad',claims:[{typ:'tid',val:'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'},{typ:'oid',val:'00000000-0000-0000-0000-000000000001'}]};
for (const path of ['/api/workspace','/api/entra']) {
  const privateResponse = await fetch(`${origin}${path}`,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'x-ms-client-principal':Buffer.from(JSON.stringify(forged)).toString('base64')}});
  if (![302,401,403].includes(privateResponse.status)) throw new Error(`Anonymous access was not rejected: ${path}`);
}
console.log(`Verified ${commit}: database ready; anonymous workspace and Entra monitoring access rejected.`);
