export type Policy = {id:string; displayName:string; state:string; [key:string]:unknown};
export type Delta = {path:string; before:unknown; after:unknown};
export type Finding = {policyId:string; name:string; kind:'created'|'modified'|'deleted'; severity:'high'|'medium'|'low'; reasons:string[]; differences:Delta[]; before:Policy|null; after:Policy|null};
// Graph metadata and timestamps do not represent effective policy configuration.
export function canonical(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!k.includes('@odata.')&&!['createdDateTime','modifiedDateTime'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function differences(before:unknown,after:unknown,path=''):Delta[] {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(before && after && typeof before==='object' && typeof after==='object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a=before as Record<string,unknown>, b=after as Record<string,unknown>;
    return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>differences(a[k],b[k],`${path}/${k}`));
  }
  return [{path:path||'/',before:before??null,after:after??null}];
}
export function comparePolicies(previous:Policy[],current:Policy[]):Finding[] {
  const a=new Map(previous.map(p=>[p.id,canonical(p) as Policy])),b=new Map(current.map(p=>[p.id,canonical(p) as Policy]));
  return [...new Set([...a.keys(),...b.keys()])].sort().flatMap(id=>{
    const before=a.get(id)??null,after=b.get(id)??null;
    const changes=differences(before,after); if(!changes.length)return [];
    const reasons:string[]=[];let severity:Finding['severity']='medium';
    if(before?.state==='enabled'&&(!after||after.state!=='enabled')) {severity='high';reasons.push('An enforced policy was removed or stopped enforcing. Its controls may no longer protect the previously targeted sign-ins.');}
    if(before?.state==='enabled'&&after?.state==='enabled') {
      if(changes.some(d=>/\/exclude/.test(d.path)&&Array.isArray(d.after)&&d.after.some(v=>!Array.isArray(d.before)||!d.before.includes(v)))) {severity='high';reasons.push('Exclusions expanded in an enforced policy. Newly excluded targets may no longer be subject to its controls.');}
      if(changes.some(d=>d.path.startsWith('/grantControls'))) {severity='high';reasons.push('Grant controls changed in an enforced policy. Review whether MFA, authentication strength, device requirements, or blocking were weakened.');}
    }
    if(changes.every(d=>d.path==='/displayName')){severity='low';reasons.push('Only the policy name changed; enforcement configuration is unchanged.');}
    if(!reasons.length)reasons.push(!before?'A policy was added. Review its targeting and controls before treating it as protection.':'Policy configuration changed. Review the before/after values and intended scope.');
    reasons.push('Risk is a deterministic review priority, not a confirmed exposure. Other policies and group membership can change effective access; affected-user counts are not calculated.');
    return [{policyId:id,name:after?.displayName??before!.displayName,kind:!before?'created':!after?'deleted':'modified',severity,reasons,differences:changes,before,after} as Finding];
  });
}
