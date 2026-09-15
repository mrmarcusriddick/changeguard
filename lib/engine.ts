export const ASSETS = [
 { id: "SERVER17", name: "SERVER17", detail: "Production · Windows Server 2022 · Known dependencies" },
 { id: "LAB02", name: "LAB02", detail: "Lab · Incomplete collector evidence" },
] as const;
export const SOURCES = ["Windows DNS", "Prometheus", "Grafana", "Windows CA", "Active Directory", "Tenable.sc"];
export type Evidence = { key: string; source: string; title: string; status: "observed" | "unknown"; severity: "blocker" | "warning" | "info" | "unknown"; detail: string; raw: Record<string, unknown>; points: number; action: string; validation: string };
export function collectMock(assetId: string): Evidence[] {
 if (!ASSETS.some(a => a.id === assetId)) throw new Error("Unsupported asset");
 const records: Evidence[] = [
 {key:"dns",source:"Windows DNS",title:"Production DNS alias",status:"observed",severity:"blocker",detail:"SQLPROD.corp.local points to SERVER17.corp.local; application-owner validation is required.",raw:{record:"SQLPROD.corp.local",type:"CNAME",target:"SERVER17.corp.local"},points:34,action:"Identify the SQLPROD service owner and approve a tested replacement target before changing DNS.",validation:"Resolve SQLPROD from representative clients and obtain application-owner connectivity evidence."},
 {key:"monitoring",source:"Prometheus",title:"Active monitoring references",status:"observed",severity:"warning",detail:"12 alert rules and 4 recording rules reference SERVER17.",raw:{target:"SERVER17:9182",alertRules:12,recordingRules:4},points:10,action:"Inventory and migrate monitoring targets and rules after the replacement service is validated.",validation:"Verify target health and evaluate dependent rules without missing series."},
 {key:"dashboards",source:"Grafana",title:"Dashboard dependencies",status:"observed",severity:"warning",detail:"Six dashboards reference SERVER17.",raw:{host:"SERVER17",dashboards:6},points:6,action:"Update the six dashboard references and retain exports of their previous configuration.",validation:"Open affected dashboards and verify expected data for the replacement host."},
 {key:"certificate",source:"Windows CA",title:"Issued TLS certificate",status:"observed",severity:"warning",detail:"An issued certificate contains SERVER17 in its SAN. Actual service use is not established.",raw:{san:["SERVER17.corp.local"],state:"issued",serviceUse:"unknown"},points:8,action:"Identify certificate consumers and provision replacement certificates where required.",validation:"Test TLS chains and hostnames on each confirmed consumer; record service-use evidence."},
 {key:"identity",source:"Active Directory",title:"Enabled computer account",status:"observed",severity:"info",detail:"SERVER17 computer account is enabled. This alone does not establish whether removal is safe.",raw:{samAccountName:"SERVER17$",enabled:true},points:0,action:"Record computer identity and group memberships; defer account removal until service validation completes.",validation:"Obtain owner confirmation and validate authentication dependencies."},
 {key:"exposure",source:"Tenable.sc",title:"Scan inventory found",status:"observed",severity:"info",detail:"A mock scan inventory record exists; vulnerability detail is outside this scenario.",raw:{host:"SERVER17",inventoryPresent:true},points:0,action:"Retain the scan inventory and reconcile the asset after the change.",validation:"Verify asset inventory is updated without losing historical evidence."},
 {key:"owner",source:"Service owner",title:"Business dependency attestation missing",status:"unknown",severity:"unknown",detail:"Application-owner confirmation and a tested rollback procedure have not been collected.",raw:{attestation:null},points:20,action:"Collect owner attestation, dependency confirmation, and a tested rollback procedure.",validation:"Attach the owner's review and rollback test evidence before scheduling execution."},
 ];
 if(assetId === "LAB02") return records.map(r => ({...r,status:"unknown",severity:"unknown",title:`${r.source} evidence unavailable`,detail:"The mock collector has no evidence for LAB02. No absence of dependencies can be inferred.",raw:{asset:"LAB02",result:null},points:20,action:`Collect and review ${r.source} evidence for LAB02.`,validation:"Review complete, asset-specific evidence before deciding readiness."}));
 return records;
}
export function scoreEvidence(items: Evidence[]) {
 const known = items.filter(i => i.status === "observed");
 const unknown = items.length-known.length;
 const dependency = Math.min(70,known.reduce((sum,i)=>sum+i.points,0));
 const uncertainty = Math.min(30,unknown*20);
 const score = Math.min(100,dependency+uncertainty);
 const blocked = known.some(i=>i.severity === "blocker");
 return { version:"cg-risk-1.0", score, dependency, uncertainty, coverage:items.length?Math.round(known.length/items.length*100):0,
  unknown, level:!items.length||!known.length?"UNRESOLVED":score>=70?"HIGH":score>=35?"MEDIUM":"LOW",
  readiness:blocked?"BLOCKED":unknown||!items.length?"UNRESOLVED":"REVIEW REQUIRED",
  recommendation:blocked?"Do not proceed: resolve observed blockers and collect missing evidence.":unknown||!items.length?"Readiness is unresolved. Collect missing evidence before making a decision.":"No blockers observed in this mock snapshot. Human review is still required.",
  contributions:items.map(i=>({key:i.key,title:i.title,kind:i.status==="unknown"?"uncertainty":"dependency",points:i.status==="unknown"?20:i.points})),
 };
}
export function makePlan(assetId:string, items:Evidence[], owner:string, window:string, constraints:string) {
 return { assetId,owner,window,constraints,state:"DRAFT — REVIEW REQUIRED",executionPerformed:false,engineVersion:"cg-risk-1.0",
  steps:[{phase:"Preparation",action:"Capture configuration exports, identify service owners, and confirm backups and a recovery window.",validation:"Owners review the baseline and demonstrate that backups can be restored."},
  ...items.map(i=>({phase:i.status==="unknown"?"Evidence collection":"Dependency resolution",action:i.action,validation:i.validation})),
  {phase:"Execution proposal",action:`Only after blockers and unknowns are resolved and a human authorizes the change: schedule a reversible shutdown of ${assetId}. Retain identity, DNS, and certificate configuration until validation is complete.`,validation:"Monitor dependent services through the agreed observation window; do not permanently delete assets during this trial."},
  {phase:"Validation",action:"Record application connectivity, monitoring, TLS and owner acceptance results.",validation:"Any failed or missing check stops further decommissioning."},
  {phase:"Rollback",action:`If validation fails, restore ${assetId} to service and restore the reviewed configuration exports under the service owner's direction.`,validation:"Re-run connectivity, authentication, TLS and monitoring checks; document recovery and stop the change."}],
 };
}
