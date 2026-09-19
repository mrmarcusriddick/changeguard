import type {Policy} from './policies.ts';
export class CollectionError extends Error {
  code:string;
  constructor(code:string, message:string){super(message);this.code=code;}
}
const endpoint='https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies';
export async function collectPolicies(fetcher:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env):Promise<Policy[]> {
  if(!env.IDENTITY_ENDPOINT||!env.IDENTITY_HEADER)throw new CollectionError('IDENTITY_NOT_READY','The App Service managed identity is not available.');
  const tokenUrl=new URL(env.IDENTITY_ENDPOINT);
  tokenUrl.searchParams.set('resource','https://graph.microsoft.com/');tokenUrl.searchParams.set('api-version','2019-08-01');
  const signal=AbortSignal.timeout(60000);
  const tokenResponse=await fetcher(tokenUrl,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},redirect:'error',signal,cache:'no-store'});
  if(!tokenResponse.ok)throw new CollectionError('IDENTITY_FAILED','Managed identity token retrieval failed. Retry after checking the app identity.');
  const token=await tokenResponse.json() as {access_token?:unknown};
  if(typeof token.access_token!=='string'||!token.access_token)throw new CollectionError('IDENTITY_FAILED','Managed identity returned an invalid token response.');
  const policies:Policy[]=[];const seen=new Set<string>();let next:string|undefined=endpoint;let pages=0;
  while(next) {
    const url=new URL(next);
    if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/identity/conditionalAccess/policies'||url.username||url.password||url.hash||seen.has(next)||++pages>100)throw new CollectionError('INCOMPLETE_SCAN','Graph pagination was invalid. The last successful snapshot is preserved.');
    seen.add(next);
    const response=await fetcher(url,{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'error',signal,cache:'no-store'});
    if(response.status===403)throw new CollectionError('CONSENT_REQUIRED','Grant Microsoft Graph Policy.Read.All application permission to this App Service managed identity, then retry. Tenant licensing or access restrictions may also prevent collection.');
    if(response.status===429)throw new CollectionError('THROTTLED','Microsoft Graph throttled this scan. Wait and retry; the last successful snapshot is preserved.');
    if(!response.ok)throw new CollectionError('GRAPH_UNAVAILABLE','Microsoft Graph could not complete the scan. The last successful snapshot is preserved.');
    const body=await response.text();
    if(body.length>4000000)throw new CollectionError('INCOMPLETE_SCAN','Graph response exceeded the collection limit.');
    let data;try{data=JSON.parse(body);}catch{throw new CollectionError('INCOMPLETE_SCAN','Graph returned an invalid response.');}
    if(!Array.isArray(data.value))throw new CollectionError('INCOMPLETE_SCAN','Graph returned an invalid policy collection.');
    for(const policy of data.value) {
      if(!policy||(typeof policy.id!=='string'||!policy.id)||typeof policy.displayName!=='string'||!['enabled','disabled','enabledForReportingButNotEnforced'].includes(policy.state)||!policy.conditions||typeof policy.conditions!=='object'||Array.isArray(policy.conditions)||policies.some(p=>p.id===policy.id))throw new CollectionError('INCOMPLETE_SCAN','Graph returned incomplete or duplicate policies.');
      policies.push(policy);
      if(policies.length>10000)throw new CollectionError('INCOMPLETE_SCAN','Policy collection exceeded the supported limit.');
    }
    if(data['@odata.nextLink']!==undefined&&(typeof data['@odata.nextLink']!=='string'||!data['@odata.nextLink']))throw new CollectionError('INCOMPLETE_SCAN','Graph returned invalid pagination.');
    next=data['@odata.nextLink'];
  }
  return policies;
}
